import {OrderStore} from '../src/orders/store.js';
const store=new OrderStore();try{process.exitCode=store.workerHealth(Math.floor(Date.now()/1000)).active?0:1;}finally{store.close();}
