// ============================================================
// Tiffin - Restaurant Ordering System (BCSE302P Review 3)
// Express REST API on top of the MongoDB database from Review 2
// Run:  npm install && npm start      ->  http://localhost:3000
// ============================================================
const express = require("express");
const path = require("path");
const { MongoClient, Double } = require("mongodb");

const URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/?directConnection=true";
const DB_NAME = process.env.DB_NAME || "restaurant_ordering";
const PORT = process.env.PORT || 3000;

let client, db;
let txEnabled = false;            // true when MongoDB runs as a replica set

// ---------- helpers ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = m => new HttpError(400, m);
const missing = m => new HttpError(404, m);
const conflict = m => new HttpError(409, m);
const wrap = fn => (req, res, next) => fn(req, res).catch(next);
const col = n => db.collection(n);
const text = (v, name, max = 80) => {
  if (typeof v !== "string" || !v.trim()) throw bad(name + " is required");
  if (v.trim().length > max) throw bad(name + " is too long");
  return v.trim();
};
const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Run `work(session)` inside an ACID transaction when available (replica set),
// otherwise run it directly (standalone mongod).
async function withTx(work) {
  if (!txEnabled) return work(undefined);
  const session = client.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await work(session); },
      { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
    return result;
  } finally { await session.endSession(); }
}

async function nextId(name, prefix, session) {
  const doc = await col("Counters").findOneAndUpdate(
    { _id: name }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after", session });
  return prefix + String(doc.seq).padStart(3, "0");
}

// Validate a cart and price it from the MenuItems collection (never trust client prices)
async function buildItems(restaurantId, lines, session) {
  if (!Array.isArray(lines) || !lines.length) throw bad("Your cart is empty");
  const merged = new Map();
  for (const l of lines) {
    const qty = Number(l.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw bad("Quantity must be between 1 and 20");
    merged.set(l.itemId, (merged.get(l.itemId) || 0) + qty);
  }
  const menu = await col("MenuItems")
    .find({ restaurantId, itemId: { $in: [...merged.keys()] } }, { session }).toArray();
  const byId = Object.fromEntries(menu.map(m => [m.itemId, m]));
  let total = 0; const items = [];
  for (const [itemId, quantity] of merged) {
    const m = byId[itemId];
    if (!m) throw bad(`Item ${itemId} is not on this restaurant's menu`);
    if (m.availability !== "Available") throw conflict(`${m.name} is currently unavailable`);
    const subtotal = m.price * quantity;
    total += subtotal;
    items.push({ itemId, name: m.name, category: m.category, price: m.price, quantity, subtotal });
  }
  return { items, total };
}

// Orders joined with restaurant + payment ($lookup)
const orderView = (match, sort = { orderDate: -1 }) => [
  { $match: match }, { $sort: sort },
  { $lookup: { from: "Restaurants", localField: "restaurantId", foreignField: "restaurantId", as: "restaurant" } },
  { $lookup: { from: "Customers", localField: "customerId", foreignField: "customerId", as: "customer" } },
  { $lookup: { from: "Payments", localField: "orderId", foreignField: "orderId", as: "payment" } },
  { $project: { _id: 0, orderId: 1, customerId: 1, restaurantId: 1, items: 1, totalAmount: 1,
      orderStatus: 1, orderDate: 1,
      restaurantName: { $first: "$restaurant.name" }, customerName: { $first: "$customer.name" },
      paymentMethod: { $first: "$payment.paymentMethod" }, paymentStatus: { $first: "$payment.paymentStatus" } } }
];

const FLOW = { "Placed": "Preparing", "Preparing": "Out for Delivery", "Out for Delivery": "Delivered" };

async function cancelOrder(orderId, session) {
  const r = await col("Orders").updateOne(
    { orderId, orderStatus: { $in: ["Placed", "Preparing"] } },
    { $set: { orderStatus: "Cancelled" } }, { session });
  if (!r.matchedCount) throw conflict("This order can no longer be cancelled");
  const pay = await col("Payments").findOne({ orderId }, { session });
  const status = pay && pay.paymentStatus === "Completed" ? "Refunded" : "Cancelled";
  await col("Payments").updateOne({ orderId }, { $set: { paymentStatus: status } }, { session });
  return status;
}

// ---------- app ----------
const app = express();
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

// ----- customers -----
app.post("/api/customers", wrap(async (req, res) => {
  const customer = {
    customerId: await nextId("customerId", "C"),
    name: text(req.body.name, "Name"),
    phone: text(req.body.phone, "Phone"),
    email: text(req.body.email, "Email").toLowerCase(),
    address: text(req.body.address, "Address", 200)
  };
  if (!/^[0-9]{10}$/.test(customer.phone)) throw bad("Phone must be 10 digits");
  if (!/^.+@.+\..+$/.test(customer.email)) throw bad("Enter a valid email address");
  await col("Customers").insertOne({ ...customer });
  res.status(201).json(customer);
}));

app.post("/api/login", wrap(async (req, res) => {
  const email = text(req.body.email, "Email").toLowerCase();
  const c = await col("Customers").findOne({ email }, { projection: { _id: 0 } });
  if (!c) throw missing("No account with that email. Create one first.");
  res.json(c);
}));

app.put("/api/customers/:id", wrap(async (req, res) => {
  const set = { name: text(req.body.name, "Name"), phone: text(req.body.phone, "Phone"),
                address: text(req.body.address, "Address", 200) };
  if (!/^[0-9]{10}$/.test(set.phone)) throw bad("Phone must be 10 digits");
  const r = await col("Customers").findOneAndUpdate({ customerId: req.params.id }, { $set: set },
    { returnDocument: "after", projection: { _id: 0 } });
  if (!r) throw missing("Customer not found");
  res.json(r);
}));

// ----- restaurants & menu -----
app.get("/api/restaurants", wrap(async (req, res) => {
  const q = {};
  if (req.query.cuisine) q.cuisine = req.query.cuisine;
  if (req.query.location) q.location = req.query.location;
  res.json(await col("Restaurants").find(q, { projection: { _id: 0 } }).sort({ rating: -1 }).toArray());
}));

app.post("/api/restaurants", wrap(async (req, res) => {
  const r = { restaurantId: await nextId("restaurantId", "R"), name: text(req.body.name, "Name"),
              location: text(req.body.location, "Location"), cuisine: text(req.body.cuisine, "Cuisine"),
              rating: new Double(0) };
  await col("Restaurants").insertOne({ ...r });
  res.status(201).json({ ...r, rating: 0 });
}));

app.get("/api/restaurants/:id/menu", wrap(async (req, res) => {
  const q = { restaurantId: req.params.id };
  if (req.query.category) q.category = req.query.category;
  if (req.query.maxPrice) q.price = { $lte: Number(req.query.maxPrice) };
  if (req.query.available === "true") q.availability = "Available";
  res.json(await col("MenuItems").find(q, { projection: { _id: 0 } }).sort({ category: 1, price: 1 }).toArray());
}));

app.get("/api/menu/search", wrap(async (req, res) => {
  const term = text(req.query.q || "", "Search term", 40);
  const items = await col("MenuItems")
    .find({ name: { $regex: escapeRegex(term), $options: "i" } }, { projection: { _id: 0 } })
    .sort({ price: 1 }).limit(30).toArray();
  const rs = await col("Restaurants").find({ restaurantId: { $in: items.map(i => i.restaurantId) } }).toArray();
  const names = Object.fromEntries(rs.map(r => [r.restaurantId, r.name]));
  res.json(items.map(i => ({ ...i, restaurantName: names[i.restaurantId] })));
}));

app.post("/api/restaurants/:id/menu", wrap(async (req, res) => {
  if (!await col("Restaurants").findOne({ restaurantId: req.params.id })) throw missing("Restaurant not found");
  const price = Number(req.body.price);
  if (!(price > 0)) throw bad("Price must be greater than 0");
  const item = { itemId: await nextId("itemId", "M"), restaurantId: req.params.id,
                 name: text(req.body.name, "Item name"), category: text(req.body.category, "Category"),
                 price, availability: req.body.availability === "Unavailable" ? "Unavailable" : "Available" };
  await col("MenuItems").insertOne({ ...item });
  res.status(201).json(item);
}));

app.put("/api/menu/:itemId", wrap(async (req, res) => {
  const set = {};
  if (req.body.price !== undefined) {
    const p = Number(req.body.price);
    if (!(p > 0)) throw bad("Price must be greater than 0");
    set.price = p;
  }
  if (req.body.availability !== undefined) {
    if (!["Available", "Unavailable"].includes(req.body.availability)) throw bad("Invalid availability");
    set.availability = req.body.availability;
  }
  if (!Object.keys(set).length) throw bad("Nothing to update");
  const r = await col("MenuItems").findOneAndUpdate({ itemId: req.params.itemId }, { $set: set },
    { returnDocument: "after", projection: { _id: 0 } });
  if (!r) throw missing("Item not found");
  res.json(r);
}));

app.delete("/api/menu/:itemId", wrap(async (req, res) => {
  const r = await col("MenuItems").deleteOne({ itemId: req.params.itemId });
  if (!r.deletedCount) throw missing("Item not found");
  res.json({ deleted: req.params.itemId });
}));

// ----- orders -----
app.post("/api/orders", wrap(async (req, res) => {
  const { customerId, restaurantId, items: lines, paymentMethod } = req.body;
  if (!["UPI", "Card", "Cash"].includes(paymentMethod)) throw bad("Choose a payment method");
  const out = await withTx(async session => {
    if (!await col("Customers").findOne({ customerId }, { session })) throw missing("Sign in before placing an order");
    if (!await col("Restaurants").findOne({ restaurantId }, { session })) throw missing("Restaurant not found");
    const { items, total } = await buildItems(restaurantId, lines, session);
    const orderId = await nextId("orderId", "O", session);
    const paymentId = await nextId("paymentId", "P", session);
    await col("Orders").insertOne({ orderId, customerId, restaurantId, items, totalAmount: total,
      orderStatus: "Placed", orderDate: new Date() }, { session });
    await col("Payments").insertOne({ paymentId, orderId, amount: total, paymentMethod,
      paymentStatus: paymentMethod === "Cash" ? "Pending" : "Completed" }, { session });
    return { orderId, paymentId, totalAmount: total };
  });
  res.status(201).json(out);
}));

app.get("/api/orders", wrap(async (req, res) => {
  if (!req.query.customerId) throw bad("customerId is required");
  res.json(await col("Orders").aggregate(orderView({ customerId: req.query.customerId })).toArray());
}));

app.get("/api/restaurants/:id/orders", wrap(async (req, res) => {
  const match = { restaurantId: req.params.id };
  if (req.query.status) match.orderStatus = req.query.status;
  res.json(await col("Orders").aggregate(orderView(match)).toArray());
}));

app.get("/api/orders/:id", wrap(async (req, res) => {
  const [o] = await col("Orders").aggregate(orderView({ orderId: req.params.id })).toArray();
  if (!o) throw missing("Order not found");
  res.json(o);
}));

// Modify an order's items (only while it is still "Placed")
app.put("/api/orders/:id/items", wrap(async (req, res) => {
  const out = await withTx(async session => {
    const o = await col("Orders").findOne({ orderId: req.params.id }, { session });
    if (!o) throw missing("Order not found");
    if (o.orderStatus !== "Placed") throw conflict("Only orders that are still Placed can be modified");
    const { items, total } = await buildItems(o.restaurantId, req.body.items, session);
    await col("Orders").updateOne({ orderId: o.orderId, orderStatus: "Placed" },
      { $set: { items, totalAmount: total } }, { session });
    await col("Payments").updateOne({ orderId: o.orderId }, { $set: { amount: total } }, { session });
    return { orderId: o.orderId, totalAmount: total };
  });
  res.json(out);
}));

app.post("/api/orders/:id/cancel", wrap(async (req, res) => {
  const paymentStatus = await withTx(session => cancelOrder(req.params.id, session));
  res.json({ orderId: req.params.id, orderStatus: "Cancelled", paymentStatus });
}));

// Restaurant moves an order along: Placed -> Preparing -> Out for Delivery -> Delivered
app.patch("/api/orders/:id/status", wrap(async (req, res) => {
  const target = req.body.status;
  const out = await withTx(async session => {
    const o = await col("Orders").findOne({ orderId: req.params.id }, { session });
    if (!o) throw missing("Order not found");
    if (target === "Cancelled") {
      const paymentStatus = await cancelOrder(o.orderId, session);
      return { orderId: o.orderId, orderStatus: "Cancelled", paymentStatus };
    }
    if (FLOW[o.orderStatus] !== target) throw conflict(`An order that is ${o.orderStatus} cannot move to ${target}`);
    await col("Orders").updateOne({ orderId: o.orderId, orderStatus: o.orderStatus },
      { $set: { orderStatus: target } }, { session });
    if (target === "Delivered")            // cash is collected on delivery
      await col("Payments").updateOne({ orderId: o.orderId, paymentStatus: "Pending" },
        { $set: { paymentStatus: "Completed" } }, { session });
    return { orderId: o.orderId, orderStatus: target };
  });
  res.json(out);
}));

// ----- analytics (aggregation framework) -----
const valid = { $match: { orderStatus: { $ne: "Cancelled" } } };

app.get("/api/analytics", wrap(async (req, res) => {
  const O = col("Orders");
  const [kpi, revenueByRestaurant, topItems, dailySales, statusCounts, paymentMethods,
         categorySales, topCustomers, pending] = await Promise.all([
    O.aggregate([valid, { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: "$totalAmount" },
        avgOrder: { $avg: "$totalAmount" } } }]).toArray(),
    O.aggregate([valid,
      { $group: { _id: "$restaurantId", orders: { $sum: 1 }, revenue: { $sum: "$totalAmount" } } },
      { $lookup: { from: "Restaurants", localField: "_id", foreignField: "restaurantId", as: "r" } },
      { $project: { _id: 0, restaurantId: "$_id", name: { $first: "$r.name" }, orders: 1, revenue: 1 } },
      { $sort: { revenue: -1 } }]).toArray(),
    O.aggregate([valid, { $unwind: "$items" },
      { $group: { _id: "$items.name", units: { $sum: "$items.quantity" }, revenue: { $sum: "$items.subtotal" } } },
      { $project: { _id: 0, name: "$_id", units: 1, revenue: 1 } },
      { $sort: { units: -1, revenue: -1 } }, { $limit: 6 }]).toArray(),
    O.aggregate([valid,
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$orderDate" } },
                  orders: { $sum: 1 }, revenue: { $sum: "$totalAmount" } } },
      { $setWindowFields: { sortBy: { _id: 1 },
          output: { cumulative: { $sum: "$revenue", window: { documents: ["unbounded", "current"] } } } } },
      { $project: { _id: 0, date: "$_id", orders: 1, revenue: 1, cumulative: 1 } },
      { $sort: { date: 1 } }]).toArray(),
    O.aggregate([{ $group: { _id: "$orderStatus", count: { $sum: 1 } } },
      { $project: { _id: 0, status: "$_id", count: 1 } }, { $sort: { count: -1 } }]).toArray(),
    col("Payments").aggregate([{ $match: { paymentStatus: "Completed" } },
      { $group: { _id: "$paymentMethod", transactions: { $sum: 1 }, amount: { $sum: "$amount" } } },
      { $project: { _id: 0, method: "$_id", transactions: 1, amount: 1 } }, { $sort: { amount: -1 } }]).toArray(),
    O.aggregate([valid, { $unwind: "$items" },
      { $group: { _id: "$items.category", units: { $sum: "$items.quantity" }, revenue: { $sum: "$items.subtotal" } } },
      { $project: { _id: 0, category: "$_id", units: 1, revenue: 1 } }, { $sort: { revenue: -1 } }]).toArray(),
    O.aggregate([valid,
      { $group: { _id: "$customerId", orders: { $sum: 1 }, spent: { $sum: "$totalAmount" } } },
      { $lookup: { from: "Customers", localField: "_id", foreignField: "customerId", as: "c" } },
      { $project: { _id: 0, customerId: "$_id", name: { $first: "$c.name" }, orders: 1, spent: 1 } },
      { $sort: { spent: -1 } }, { $limit: 5 }]).toArray(),
    col("Payments").countDocuments({ paymentStatus: "Pending" })
  ]);
  const k = kpi[0] || { orders: 0, revenue: 0, avgOrder: 0 };
  res.json({
    kpis: { orders: k.orders, revenue: k.revenue, avgOrder: Math.round(k.avgOrder * 100) / 100,
            activeOrders: statusCounts.filter(s => !["Delivered", "Cancelled"].includes(s.status))
                                      .reduce((s, x) => s + x.count, 0),
            pendingPayments: pending },
    revenueByRestaurant, topItems, dailySales, statusCounts, paymentMethods, categorySales, topCustomers
  });
}));

// Recommendation: best-selling available dishes this customer has not tried yet
app.get("/api/recommendations/:customerId", wrap(async (req, res) => {
  const tried = await col("Orders").distinct("items.itemId", { customerId: req.params.customerId });
  const recs = await col("Orders").aggregate([valid, { $unwind: "$items" },
    { $match: { "items.itemId": { $nin: tried } } },
    { $group: { _id: "$items.itemId", name: { $first: "$items.name" }, units: { $sum: "$items.quantity" } } },
    { $lookup: { from: "MenuItems", localField: "_id", foreignField: "itemId", as: "m" } },
    { $unwind: "$m" }, { $match: { "m.availability": "Available" } },
    { $lookup: { from: "Restaurants", localField: "m.restaurantId", foreignField: "restaurantId", as: "r" } },
    { $project: { _id: 0, itemId: "$_id", name: 1, price: "$m.price", restaurantId: "$m.restaurantId",
                  restaurantName: { $first: "$r.name" }, units: 1 } },
    { $sort: { units: -1 } }, { $limit: 5 }]).toArray();
  res.json(recs);
}));

// ----- errors -----
app.use("/api", (req, res) => res.status(404).json({ error: "Unknown API route" }));
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.code === 11000) return res.status(409).json({ error: "That value already exists (for example, the email is already registered)" });
  if (err.code === 121) return res.status(400).json({ error: "The data did not pass the database validation rules" });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server" });
});

// ---------- start ----------
(async () => {
  client = new MongoClient(URI, { serverSelectionTimeoutMS: 5000 });
  try { await client.connect(); }
  catch (e) {
    console.error("Cannot reach MongoDB at " + URI + "\n" + e.message);
    process.exit(1);
  }
  db = client.db(DB_NAME);
  if (!(await col("Customers").estimatedDocumentCount())) {
    console.error(`Database '${DB_NAME}' is empty. Run first:  mongosh --file ../01_create_and_seed.js`);
    process.exit(1);
  }
  const hello = await db.command({ hello: 1 });
  txEnabled = Boolean(hello.setName);
  await col("Customers").createIndex({ email: 1 }, { unique: true });
  await col("Orders").createIndex({ customerId: 1, orderDate: -1 });
  await col("Orders").createIndex({ restaurantId: 1, orderStatus: 1 });
  await col("MenuItems").createIndex({ restaurantId: 1, category: 1, price: 1 });
  app.listen(PORT, () => {
    console.log(`Tiffin running on http://localhost:${PORT}`);
    console.log(txEnabled ? "Transactions: ON (replica set)" : "Transactions: OFF (standalone mongod - orders still work, without ACID rollback)");
  });
})();
