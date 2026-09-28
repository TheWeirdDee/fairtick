import { OrderStore } from "../src/orders/store.js";
const store=new OrderStore(); console.log(store.db.prepare("SELECT * FROM schema_migrations").all());store.close();
