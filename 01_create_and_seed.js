// ============================================================
// 01_create_and_seed.js
// Creates the database, collections (with schema validation)
// and loads 76 sample documents.
// Run:  mongosh --file 01_create_and_seed.js
// ============================================================
const rdb = db.getSiblingDB("restaurant_ordering");
rdb.dropDatabase();

// ---------- 1. Collections with $jsonSchema validation ----------
rdb.createCollection("Customers", {
  validator: { $jsonSchema: {
    bsonType: "object",
    required: ["customerId", "name", "phone", "email", "address"],
    properties: {
      customerId: { bsonType: "string", pattern: "^C[0-9]{3,}$" },
      name:       { bsonType: "string" },
      phone:      { bsonType: "string", pattern: "^[0-9]{10}$" },
      email:      { bsonType: "string", pattern: "^.+@.+\\..+$" },
      address:    { bsonType: "string" }
    } } }
});

rdb.createCollection("Restaurants", {
  validator: { $jsonSchema: {
    bsonType: "object",
    required: ["restaurantId", "name", "location", "cuisine", "rating"],
    properties: {
      restaurantId: { bsonType: "string" },
      name:         { bsonType: "string" },
      location:     { bsonType: "string" },
      cuisine:      { bsonType: "string" },
      rating:       { bsonType: ["double", "int"], minimum: 0, maximum: 5 }
    } } }
});

rdb.createCollection("MenuItems", {
  validator: { $jsonSchema: {
    bsonType: "object",
    required: ["itemId", "restaurantId", "name", "category", "price", "availability"],
    properties: {
      itemId:       { bsonType: "string" },
      restaurantId: { bsonType: "string" },
      name:         { bsonType: "string" },
      category:     { bsonType: "string" },
      price:        { bsonType: ["int", "double", "long"], minimum: 0 },
      availability: { enum: ["Available", "Unavailable"] }
    } } }
});

rdb.createCollection("Orders", {
  validator: { $jsonSchema: {
    bsonType: "object",
    required: ["orderId", "customerId", "restaurantId", "items", "totalAmount", "orderStatus", "orderDate"],
    properties: {
      orderId:     { bsonType: "string" },
      customerId:  { bsonType: "string" },
      restaurantId:{ bsonType: "string" },
      items: { bsonType: "array", minItems: 1,
        items: { bsonType: "object",
          required: ["itemId", "name", "price", "quantity", "subtotal"],
          properties: { quantity: { bsonType: "int", minimum: 1 } } } },
      totalAmount: { bsonType: ["int", "double", "long"], minimum: 0 },
      orderStatus: { enum: ["Placed", "Preparing", "Out for Delivery", "Delivered", "Cancelled"] },
      orderDate:   { bsonType: "date" }
    } } }
});

rdb.createCollection("Payments", {
  validator: { $jsonSchema: {
    bsonType: "object",
    required: ["paymentId", "orderId", "amount", "paymentMethod", "paymentStatus"],
    properties: {
      paymentId:     { bsonType: "string" },
      orderId:       { bsonType: "string" },
      amount:        { bsonType: ["int", "double", "long"], minimum: 0 },
      paymentMethod: { enum: ["UPI", "Card", "Cash"] },
      paymentStatus: { enum: ["Pending", "Completed", "Refunded", "Cancelled"] }
    } } }
});

rdb.createCollection("Counters");   // used to generate orderId / paymentId

// ---------- 2. Customers (10) ----------
print("Inserting Customers...");
rdb.Customers.insertMany([
  { customerId: "C001", name: "Rahul",    phone: "9876543210", email: "rahul@gmail.com",   address: "Vellore" },
  { customerId: "C002", name: "Arjun",    phone: "9876543211", email: "arjun@gmail.com",   address: "Katpadi" },
  { customerId: "C003", name: "Priya",    phone: "9876543212", email: "priya@gmail.com",   address: "Chennai" },
  { customerId: "C004", name: "Divya",    phone: "9876543213", email: "divya@gmail.com",   address: "Vellore" },
  { customerId: "C005", name: "Karthik",  phone: "9876543214", email: "karthik@gmail.com", address: "Katpadi" },
  { customerId: "C006", name: "Meena",    phone: "9876543215", email: "meena@gmail.com",   address: "Chennai" },
  { customerId: "C007", name: "Suresh",   phone: "9876543216", email: "suresh@gmail.com",  address: "Vellore" },
  { customerId: "C008", name: "Anitha",   phone: "9876543217", email: "anitha@gmail.com",  address: "Katpadi" },
  { customerId: "C009", name: "Vikram",   phone: "9876543218", email: "vikram@gmail.com",  address: "Chennai" },
  { customerId: "C010", name: "Lakshmi",  phone: "9876543219", email: "lakshmi@gmail.com", address: "Vellore" }
]);

// ---------- 3. Restaurants (6) ----------

print("Inserting Restaurants...");
rdb.Restaurants.insertMany([
  { restaurantId: "R001", name: "Spice Hub",    location: "Vellore", cuisine: "Indian",        rating: 4.5 },
  { restaurantId: "R002", name: "Pizza Corner", location: "Katpadi", cuisine: "Italian",       rating: 4.2 },
  { restaurantId: "R003", name: "Burger House", location: "Vellore", cuisine: "Fast Food",     rating: 4.3 },
  { restaurantId: "R004", name: "Dragon Wok",   location: "Vellore", cuisine: "Chinese",       rating: 4.0 },
  { restaurantId: "R005", name: "South Spice",  location: "Katpadi", cuisine: "South Indian",  rating: 4.6 },
  { restaurantId: "R006", name: "Cafe Aroma",   location: "Chennai", cuisine: "Cafe",          rating: 4.1 }
]);

// ---------- 4. MenuItems (30) ----------
const A = "Available", U = "Unavailable";
const menu = [
  ["M001","R001","Chicken Biryani","Main Course",180,A], ["M002","R001","Paneer Butter Masala","Main Course",150,A],
  ["M006","R001","Butter Naan","Sides",30,A],            ["M007","R001","Dal Tadka","Main Course",120,A],
  ["M008","R001","Gulab Jamun","Dessert",60,A],
  ["M003","R002","Farmhouse Pizza","Pizza",250,A],       ["M004","R002","Garlic Bread","Sides",120,A],
  ["M009","R002","Margherita Pizza","Pizza",200,A],      ["M010","R002","Pasta Alfredo","Pasta",180,A],
  ["M011","R002","Tiramisu","Dessert",140,U],
  ["M005","R003","Chicken Burger","Burger",160,A],       ["M012","R003","Veg Burger","Burger",110,A],
  ["M013","R003","French Fries","Sides",80,A],           ["M014","R003","Chicken Wings","Starters",190,A],
  ["M015","R003","Chocolate Shake","Beverages",120,A],
  ["M016","R004","Veg Fried Rice","Main Course",130,A],  ["M017","R004","Chicken Noodles","Main Course",150,A],
  ["M018","R004","Gobi Manchurian","Starters",120,A],    ["M019","R004","Chilli Chicken","Starters",170,A],
  ["M020","R004","Spring Rolls","Starters",90,U],
  ["M021","R005","Masala Dosa","Breakfast",80,A],        ["M022","R005","Idli Sambar","Breakfast",50,A],
  ["M023","R005","Filter Coffee","Beverages",30,A],      ["M024","R005","Full Meals","Main Course",140,A],
  ["M025","R005","Medu Vada","Breakfast",45,A],
  ["M026","R006","Cappuccino","Beverages",110,A],        ["M027","R006","Veg Sandwich","Snacks",100,A],
  ["M028","R006","Brownie","Dessert",90,A],              ["M029","R006","Cold Coffee","Beverages",120,A],
  ["M030","R006","Cheese Omelette","Snacks",85,U]
].map(([itemId, restaurantId, name, category, price, availability]) =>
      ({ itemId, restaurantId, name, category, price, availability }));
      print("Inserting MenuItems...");
      rdb.MenuItems.insertMany(menu);

// ---------- 5. Orders (15) + Payments (15) ----------
// lines = [itemId, quantity]; item details & totals are computed from MenuItems
const seeds = [
  ["O001","C001","R001",[["M001",2]],                         "Preparing",        "2026-10-01","UPI", "Completed"],
  ["O002","C002","R002",[["M003",1]],                         "Delivered",        "2026-09-28","Card","Completed"],
  ["O003","C003","R003",[["M005",2]],                         "Out for Delivery", "2026-10-02","Cash","Pending"],
  ["O004","C004","R004",[["M016",1],["M019",1]],              "Delivered",        "2026-09-29","UPI", "Completed"],
  ["O005","C005","R005",[["M021",2],["M023",2]],              "Delivered",        "2026-09-30","Cash","Completed"],
  ["O006","C001","R002",[["M009",1],["M004",1]],              "Delivered",        "2026-09-25","Card","Completed"],
  ["O007","C006","R001",[["M002",1],["M006",3]],              "Placed",           "2026-10-03","UPI", "Pending"],
  ["O008","C007","R003",[["M012",2],["M013",1],["M015",2]],   "Delivered",        "2026-09-27","UPI", "Completed"],
  ["O009","C008","R006",[["M026",2],["M028",1]],              "Cancelled",        "2026-09-26","Card","Refunded"],
  ["O010","C002","R001",[["M001",1],["M007",1],["M008",2]],   "Delivered",        "2026-09-24","Card","Completed"],
  ["O011","C009","R004",[["M017",2],["M018",1]],              "Preparing",        "2026-10-01","UPI", "Completed"],
  ["O012","C010","R005",[["M024",2]],                         "Delivered",        "2026-09-28","Cash","Completed"],
  ["O013","C003","R002",[["M010",1],["M003",1]],              "Out for Delivery", "2026-10-02","Cash","Pending"],
  ["O014","C004","R006",[["M029",1],["M027",2]],              "Delivered",        "2026-09-30","UPI", "Completed"],
  ["O015","C001","R003",[["M014",1],["M005",1]],              "Cancelled",        "2026-09-29","UPI", "Refunded"]
];
const byId = {}; menu.forEach(m => byId[m.itemId] = m);
const orders = [], payments = [];
seeds.forEach(([orderId, customerId, restaurantId, lines, orderStatus, date, method, payStatus], i) => {
  const items = lines.map(([id, q]) => ({
    itemId: id, name: byId[id].name, category: byId[id].category,
    price: byId[id].price, quantity: NumberInt(q), subtotal: byId[id].price * q }));
  const totalAmount = items.reduce((s, it) => s + it.subtotal, 0);
  orders.push({ orderId, customerId, restaurantId, items, totalAmount, orderStatus,
                orderDate: new Date(date + "T12:00:00Z") });
  payments.push({ paymentId: "P" + String(i + 1).padStart(3, "0"), orderId,
                  amount: totalAmount, paymentMethod: method, paymentStatus: payStatus });
});
print("Inserting Orders...");
rdb.Orders.insertMany(orders);
print("Inserting Payments...");
rdb.Payments.insertMany(payments);

rdb.Counters.insertMany([{ _id: "orderId", seq: 15 }, { _id: "paymentId", seq: 15 }]);

// ---------- 6. Summary ----------
print("Database 'restaurant_ordering' created.");
let total = 0;
["Customers","Restaurants","MenuItems","Orders","Payments"].forEach(c => {
  const n = rdb.getCollection(c).countDocuments(); total += n;
  print("  " + c.padEnd(12) + n);
});
print("  TOTAL".padEnd(14) + total + " documents");
