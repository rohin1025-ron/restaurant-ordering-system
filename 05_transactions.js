// ============================================================
// 05_transactions.js - Multi-document ACID transactions
// NOTE: transactions need a replica set (or MongoDB Atlas). See README.
// Run:  mongosh --file 05_transactions.js
// ============================================================
const DB = "restaurant_ordering";
const pad = n => String(n).padStart(3, "0");

// ---------- Transaction 1: place an order (order + payment + counters, all-or-nothing) ----------
function placeOrder(customerId, restaurantId, lines, paymentMethod) {
  const session = db.getMongo().startSession();
  const sdb = session.getDatabase(DB);
  session.startTransaction({ readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
  try {
    if (!sdb.Customers.findOne({ customerId })) throw new Error("Customer " + customerId + " not found");
    if (!sdb.Restaurants.findOne({ restaurantId })) throw new Error("Restaurant " + restaurantId + " not found");

    const items = []; let total = 0;
    for (const [itemId, qty] of lines) {
      const m = sdb.MenuItems.findOne({ itemId, restaurantId });
      if (!m) throw new Error("Item " + itemId + " does not belong to " + restaurantId);
      if (m.availability !== "Available") throw new Error(m.name + " is currently unavailable");
      const subtotal = m.price * qty;
      items.push({ itemId, name: m.name, category: m.category, price: m.price,
                   quantity: NumberInt(qty), subtotal });
      total += subtotal;
    }
    const oSeq = sdb.Counters.findOneAndUpdate({ _id: "orderId" },   { $inc: { seq: 1 } }, { returnNewDocument: true }).seq;
    const pSeq = sdb.Counters.findOneAndUpdate({ _id: "paymentId" }, { $inc: { seq: 1 } }, { returnNewDocument: true }).seq;
    const orderId = "O" + pad(oSeq), paymentId = "P" + pad(pSeq);

    sdb.Orders.insertOne({ orderId, customerId, restaurantId, items, totalAmount: total,
                           orderStatus: "Placed", orderDate: new Date() });
    sdb.Payments.insertOne({ paymentId, orderId, amount: total, paymentMethod,
                             paymentStatus: paymentMethod === "Cash" ? "Pending" : "Completed" });
    session.commitTransaction();
    print("COMMITTED  -> " + orderId + " / " + paymentId + "  total = Rs." + total);
    return orderId;
  } catch (err) {
    session.abortTransaction();
    print("ROLLED BACK -> " + err.message);
    return null;
  } finally {
    session.endSession();
  }
}

// ---------- Transaction 2: cancel an order and refund the payment ----------
function cancelOrder(orderId) {
  const session = db.getMongo().startSession();
  const sdb = session.getDatabase(DB);
  session.startTransaction({ readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
  try {
    const r = sdb.Orders.updateOne(
      { orderId, orderStatus: { $in: ["Placed", "Preparing"] } },
      { $set: { orderStatus: "Cancelled" } });
    if (r.modifiedCount === 0) throw new Error("Order " + orderId + " cannot be cancelled (not found or already dispatched)");
    const pay = sdb.Payments.findOne({ orderId });
    const newStatus = pay.paymentStatus === "Completed" ? "Refunded" : "Cancelled";
    sdb.Payments.updateOne({ orderId }, { $set: { paymentStatus: newStatus } });
    session.commitTransaction();
    print("COMMITTED  -> " + orderId + " cancelled, payment " + newStatus);
  } catch (err) {
    session.abortTransaction();
    print("ROLLED BACK -> " + err.message);
  } finally {
    session.endSession();
  }
}

const rdb = db.getSiblingDB(DB);
try {
  print("\n--- Demo 1: successful order ---");
  const newId = placeOrder("C005", "R001", [["M001", 1], ["M006", 2]], "UPI");

  print("\n--- Demo 2: failing order (M011 Tiramisu is Unavailable) -> nothing is saved ---");
  const before = rdb.Orders.countDocuments();
  placeOrder("C005", "R002", [["M003", 1], ["M011", 1]], "Card");
  print("Orders before: " + before + " | after: " + rdb.Orders.countDocuments() + "  (unchanged = rollback worked)");

  print("\n--- Demo 3: cancel the new order (refund) ---");
  if (newId) cancelOrder(newId);

  print("\n--- Demo 4: cancelling an already dispatched order fails ---");
  cancelOrder("O003");

  print("\nFinal state of " + newId + ":");
  printjson(rdb.Orders.findOne({ orderId: newId }, { _id: 0, orderId: 1, orderStatus: 1, totalAmount: 1 }));
  printjson(rdb.Payments.findOne({ orderId: newId }, { _id: 0, paymentId: 1, paymentStatus: 1 }));
} catch (e) {
  print("Transactions require a replica set. Error: " + e.message);
}
