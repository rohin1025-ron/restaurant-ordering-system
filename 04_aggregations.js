// ============================================================
// 04_aggregations.js - Analytics using the aggregation framework
// Run:  mongosh --file 04_aggregations.js
// ============================================================
const rdb = db.getSiblingDB("restaurant_ordering");
const run = (title, coll, pipeline) => {
  print("\n=== " + title + " ===");
  rdb.getCollection(coll).aggregate(pipeline).forEach(d => printjson(d));
};
const valid = { $match: { orderStatus: { $ne: "Cancelled" } } };   // ignore cancelled orders

// 1. Revenue, order count and average order value per restaurant ($group + $lookup)
run("1. Revenue per restaurant", "Orders", [
  valid,
  { $group: { _id: "$restaurantId", orders: { $sum: 1 }, revenue: { $sum: "$totalAmount" },
              avgOrderValue: { $avg: "$totalAmount" } } },
  { $lookup: { from: "Restaurants", localField: "_id", foreignField: "restaurantId", as: "r" } },
  { $unwind: "$r" },
  { $project: { _id: 0, restaurantId: "$_id", restaurant: "$r.name", cuisine: "$r.cuisine",
                orders: 1, revenue: 1, avgOrderValue: { $round: ["$avgOrderValue", 2] } } },
  { $sort: { revenue: -1 } }
]);

// 2. Top 5 best-selling items ($unwind embedded items)
run("2. Top 5 best-selling items", "Orders", [
  valid,
  { $unwind: "$items" },
  { $group: { _id: "$items.name", unitsSold: { $sum: "$items.quantity" }, revenue: { $sum: "$items.subtotal" } } },
  { $sort: { unitsSold: -1, revenue: -1 } },
  { $limit: 5 }
]);

// 3. Customer spending ranking ($lookup to Customers)
run("3. Top customers by total spend", "Orders", [
  valid,
  { $group: { _id: "$customerId", orders: { $sum: 1 }, totalSpent: { $sum: "$totalAmount" } } },
  { $lookup: { from: "Customers", localField: "_id", foreignField: "customerId", as: "c" } },
  { $unwind: "$c" },
  { $project: { _id: 0, customerId: "$_id", name: "$c.name", orders: 1, totalSpent: 1 } },
  { $sort: { totalSpent: -1 } }, { $limit: 5 }
]);

// 4. Order-status distribution
run("4. Orders by status", "Orders", [
  { $group: { _id: "$orderStatus", count: { $sum: 1 } } },
  { $sort: { count: -1 } }
]);

// 5. Payment method analysis (only completed payments)
run("5. Revenue by payment method", "Payments", [
  { $match: { paymentStatus: "Completed" } },
  { $group: { _id: "$paymentMethod", transactions: { $sum: 1 }, amount: { $sum: "$amount" } } },
  { $sort: { amount: -1 } }
]);

// 6. Category-wise sales
run("6. Sales by menu category", "Orders", [
  valid,
  { $unwind: "$items" },
  { $group: { _id: "$items.category", unitsSold: { $sum: "$items.quantity" }, revenue: { $sum: "$items.subtotal" } } },
  { $sort: { revenue: -1 } }
]);

// 7. Daily sales with running total ($dateToString + $setWindowFields, MongoDB 5.0+)
run("7. Daily sales with cumulative revenue", "Orders", [
  valid,
  { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$orderDate" } },
              orders: { $sum: 1 }, revenue: { $sum: "$totalAmount" } } },
  { $setWindowFields: { sortBy: { _id: 1 },
      output: { cumulativeRevenue: { $sum: "$revenue", window: { documents: ["unbounded", "current"] } } } } },
  { $sort: { _id: 1 } }
]);

// 8. Order-value buckets ($bucket)
run("8. Order value distribution", "Orders", [
  valid,
  { $bucket: { groupBy: "$totalAmount", boundaries: [0, 200, 400, 600, 1000], default: "1000+",
               output: { orders: { $sum: 1 }, avgValue: { $avg: "$totalAmount" } } } }
]);

// 9. Dashboard in a single query ($facet)
run("9. Dashboard summary ($facet)", "Orders", [
  { $facet: {
      totals:   [ valid, { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: "$totalAmount" } } } ],
      byStatus: [ { $group: { _id: "$orderStatus", n: { $sum: 1 } } } ],
      topCity:  [ valid,
                  { $lookup: { from: "Customers", localField: "customerId", foreignField: "customerId", as: "c" } },
                  { $unwind: "$c" },
                  { $group: { _id: "$c.address", orders: { $sum: 1 } } }, { $sort: { orders: -1 } }, { $limit: 3 } ]
  } }
]);

// 10. Recommendation: popular available items that customer C001 has NOT ordered yet
const target = "C001";
const alreadyOrdered = rdb.Orders.distinct("items.itemId", { customerId: target });
run("10. Recommended items for " + target, "Orders", [
  valid,
  { $unwind: "$items" },
  { $match: { "items.itemId": { $nin: alreadyOrdered } } },
  { $group: { _id: "$items.itemId", name: { $first: "$items.name" }, unitsSold: { $sum: "$items.quantity" } } },
  { $lookup: { from: "MenuItems", localField: "_id", foreignField: "itemId", as: "m" } },
  { $unwind: "$m" },
  { $match: { "m.availability": "Available" } },
  { $project: { _id: 0, itemId: "$_id", name: 1, restaurantId: "$m.restaurantId", price: "$m.price", unitsSold: 1 } },
  { $sort: { unitsSold: -1 } }, { $limit: 5 }
]);

// 11. Full order details with customer, restaurant and payment ($lookup x3)
run("11. Order O001 - complete view", "Orders", [
  { $match: { orderId: "O001" } },
  { $lookup: { from: "Customers",   localField: "customerId",   foreignField: "customerId",   as: "customer" } },
  { $lookup: { from: "Restaurants", localField: "restaurantId", foreignField: "restaurantId", as: "restaurant" } },
  { $lookup: { from: "Payments",    localField: "orderId",      foreignField: "orderId",      as: "payment" } },
  { $unwind: "$customer" }, { $unwind: "$restaurant" }, { $unwind: "$payment" },
  { $project: { _id: 0, orderId: 1, customer: "$customer.name", restaurant: "$restaurant.name",
                items: 1, totalAmount: 1, orderStatus: 1,
                paymentMethod: "$payment.paymentMethod", paymentStatus: "$payment.paymentStatus" } }
]);
