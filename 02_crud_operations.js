// ============================================================
// 02_crud_operations.js  -  Create / Read / Update / Delete
// Run:  mongosh --file 02_crud_operations.js
// (Test documents are created and removed, seed data stays intact)
// ============================================================
const rdb = db.getSiblingDB("restaurant_ordering");
const show = (t, v) => { print("\n--- " + t + " ---"); printjson(v); };

// ======================= CREATE =======================
print("\n================ CREATE ================");
show("insertOne: register new customer",
  rdb.Customers.insertOne({ customerId: "C011", name: "Test User", phone: "9876543220",
                            email: "test@gmail.com", address: "Vellore" }));

show("insertMany: add menu items to Spice Hub",
  rdb.MenuItems.insertMany([
    { itemId: "M031", restaurantId: "R001", name: "Veg Biryani",  category: "Main Course", price: 140, availability: "Available" },
    { itemId: "M032", restaurantId: "R001", name: "Mango Lassi",  category: "Beverages",   price: 70,  availability: "Available" }
  ]));

show("insertOne: place an order (items embedded)",
  rdb.Orders.insertOne({
    orderId: "O900", customerId: "C011", restaurantId: "R001",
    items: [
      { itemId: "M031", name: "Veg Biryani", category: "Main Course", price: 140, quantity: NumberInt(2), subtotal: 280 },
      { itemId: "M032", name: "Mango Lassi", category: "Beverages",   price: 70,  quantity: NumberInt(1), subtotal: 70 }
    ],
    totalAmount: 350, orderStatus: "Placed", orderDate: new Date() }));

show("insertOne: payment for that order",
  rdb.Payments.insertOne({ paymentId: "P900", orderId: "O900", amount: 350,
                           paymentMethod: "UPI", paymentStatus: "Pending" }));

// ======================= READ =======================
print("\n================ READ ================");
show("find: all available items of Spice Hub (projection, sort by price)",
  rdb.MenuItems.find({ restaurantId: "R001", availability: "Available" },
                     { _id: 0, name: 1, category: 1, price: 1 }).sort({ price: 1 }).toArray());

show("find: Main Course items priced between 120 and 160",
  rdb.MenuItems.find({ category: "Main Course", price: { $gte: 120, $lte: 160 } },
                     { _id: 0, name: 1, price: 1, restaurantId: 1 }).toArray());

show("find: search item by name (regex, case-insensitive)",
  rdb.MenuItems.find({ name: /pizza/i }, { _id: 0, name: 1, price: 1 }).toArray());

show("find: restaurants in Vellore or Katpadi with rating >= 4.3",
  rdb.Restaurants.find({ location: { $in: ["Vellore", "Katpadi"] }, rating: { $gte: 4.3 } },
                       { _id: 0, name: 1, cuisine: 1, rating: 1 }).sort({ rating: -1 }).toArray());

show("find: order history of customer C001 (latest first)",
  rdb.Orders.find({ customerId: "C001" },
                  { _id: 0, orderId: 1, totalAmount: 1, orderStatus: 1, orderDate: 1 })
            .sort({ orderDate: -1 }).toArray());

show("find: orders that contain Chicken Biryani (query inside embedded array)",
  rdb.Orders.find({ "items.name": "Chicken Biryani" }, { _id: 0, orderId: 1, customerId: 1 }).toArray());

show("find: active orders (not Delivered / Cancelled)",
  rdb.Orders.find({ orderStatus: { $nin: ["Delivered", "Cancelled"] } },
                  { _id: 0, orderId: 1, orderStatus: 1 }).toArray());

show("countDocuments: pending payments", rdb.Payments.countDocuments({ paymentStatus: "Pending" }));
show("distinct: cuisines", rdb.Restaurants.distinct("cuisine"));

// ======================= UPDATE =======================
print("\n================ UPDATE ================");
show("updateOne: change customer phone",
  rdb.Customers.updateOne({ customerId: "C011" }, { $set: { phone: "9000000011" } }));

show("updateOne: order status Placed -> Preparing",
  rdb.Orders.updateOne({ orderId: "O900" }, { $set: { orderStatus: "Preparing" } }));
show("updateOne: order status Preparing -> Out for Delivery",
  rdb.Orders.updateOne({ orderId: "O900" }, { $set: { orderStatus: "Out for Delivery" } }));
show("updateOne: order status -> Delivered",
  rdb.Orders.updateOne({ orderId: "O900" }, { $set: { orderStatus: "Delivered" } }));

show("updateOne: payment Pending -> Completed",
  rdb.Payments.updateOne({ paymentId: "P900" }, { $set: { paymentStatus: "Completed" } }));

show("updateOne: mark item unavailable",
  rdb.MenuItems.updateOne({ itemId: "M032" }, { $set: { availability: "Unavailable" } }));

show("updateMany: 10% price rise for all Spice Hub desserts ($mul)",
  rdb.MenuItems.updateMany({ restaurantId: "R001", category: "Dessert" }, { $mul: { price: 1.1 } }));
show("   verify", rdb.MenuItems.find({ restaurantId: "R001", category: "Dessert" },
                                     { _id: 0, name: 1, price: 1 }).toArray());
// revert so that seed data stays the same
rdb.MenuItems.updateMany({ restaurantId: "R001", category: "Dessert" }, { $set: { price: 60 } });

show("updateOne: increase rating using $inc",
  rdb.Restaurants.updateOne({ restaurantId: "R004" }, { $inc: { rating: 0.1 } }));
rdb.Restaurants.updateOne({ restaurantId: "R004" }, { $set: { rating: 4.0 } });   // revert

show("updateOne with upsert: create restaurant if missing",
  rdb.Restaurants.updateOne({ restaurantId: "R007" },
    { $set: { name: "Temp Cafe", location: "Vellore", cuisine: "Cafe", rating: 3.5 } }, { upsert: true }));

show("updateOne: add extra item to an order ($push)",
  rdb.Orders.updateOne({ orderId: "O900" }, {
    $push: { items: { itemId: "M031", name: "Veg Biryani", category: "Main Course",
                      price: 140, quantity: NumberInt(1), subtotal: 140 } },
    $inc: { totalAmount: 140 } }));

// ======================= DELETE =======================
print("\n================ DELETE ================");
show("deleteOne: remove payment P900",   rdb.Payments.deleteOne({ paymentId: "P900" }));
show("deleteOne: remove order O900",     rdb.Orders.deleteOne({ orderId: "O900" }));
show("deleteMany: remove test menu items", rdb.MenuItems.deleteMany({ itemId: { $in: ["M031", "M032"] } }));
show("deleteOne: remove test restaurant", rdb.Restaurants.deleteOne({ restaurantId: "R007" }));
show("deleteOne: remove test customer",   rdb.Customers.deleteOne({ customerId: "C011" }));

print("\nCRUD demo complete.");
