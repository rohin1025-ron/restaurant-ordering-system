// ============================================================
// 03_indexes.js - Indexing + query-plan proof (explain)
// Run:  mongosh --file 03_indexes.js
// ============================================================
const rdb = db.getSiblingDB("restaurant_ordering");

// ---------- Unique indexes (data integrity) ----------
rdb.Customers.createIndex({ customerId: 1 }, { unique: true });
rdb.Customers.createIndex({ email: 1 },      { unique: true });
rdb.Restaurants.createIndex({ restaurantId: 1 }, { unique: true });
rdb.MenuItems.createIndex({ itemId: 1 },     { unique: true });
rdb.Orders.createIndex({ orderId: 1 },       { unique: true });
rdb.Payments.createIndex({ paymentId: 1 },   { unique: true });
rdb.Payments.createIndex({ orderId: 1 },     { unique: true });   // one payment per order

// ---------- Compound indexes (match the app's main queries) ----------
rdb.MenuItems.createIndex({ restaurantId: 1, category: 1, price: 1 });   // browse/filter menu
rdb.Orders.createIndex({ customerId: 1, orderDate: -1 });                // order history
rdb.Orders.createIndex({ restaurantId: 1, orderStatus: 1 });             // restaurant dashboard
rdb.Restaurants.createIndex({ location: 1, cuisine: 1, rating: -1 });    // restaurant search

// ---------- Multikey index on embedded array ----------
rdb.Orders.createIndex({ "items.itemId": 1 });                           // popularity / recommendations

// ---------- Text index (search menu by keyword) ----------
rdb.MenuItems.createIndex({ name: "text", category: "text" });

// ---------- Partial index (only active orders) ----------
rdb.Orders.createIndex({ orderStatus: 1, orderDate: -1 },
  { partialFilterExpression: { orderStatus: { $in: ["Placed", "Preparing", "Out for Delivery"] } },
    name: "active_orders_idx" });

print("Indexes created:");
["Customers","Restaurants","MenuItems","Orders","Payments"].forEach(c => {
  print("\n" + c);
  rdb.getCollection(c).getIndexes().forEach(i => print("   " + i.name + "  " + JSON.stringify(i.key)));
});

// ---------- Prove the indexes are used ----------
function plan(title, cursor) {
  const e = cursor.explain("executionStats").executionStats;
  const stage = JSON.stringify(cursor.explain().queryPlanner.winningPlan).includes("IXSCAN") ? "IXSCAN (index)" : "COLLSCAN";
  print("\n" + title + "\n   plan: " + stage + " | docs examined: " + e.totalDocsExamined +
        " | keys examined: " + e.totalKeysExamined + " | returned: " + e.nReturned);
}
print("\n=========== EXPLAIN ===========");
plan("Order history of C001",
     rdb.Orders.find({ customerId: "C001" }).sort({ orderDate: -1 }));
plan("Spice Hub Main Course under 200",
     rdb.MenuItems.find({ restaurantId: "R001", category: "Main Course", price: { $lt: 200 } }));
plan("Orders containing M003",
     rdb.Orders.find({ "items.itemId": "M003" }));
plan("Text search 'pizza'",
     rdb.MenuItems.find({ $text: { $search: "pizza" } }));
plan("Active orders",
     rdb.Orders.find({ orderStatus: "Preparing" }).sort({ orderDate: -1 }).hint("active_orders_idx"));
