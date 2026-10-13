import { adminDb } from "@/lib/firebase-admin";
import { randomUUID } from "node:crypto";
const storeRef = () => adminDb().collection("procureflowDemo").doc("workspace");
export const uid = () => randomUUID();
export type Store = { rfqs: any[]; vendors: any[]; items: any[]; quotes: any[]; bids: any[]; auditLogs: any[]; comments: any[]; counterBids: any[]; purchaseOrders: any[] };
const now = () => new Date().toISOString();
function initial(): Store {
 const vendors = ["Aster Precision Works","Vardhan Engineering Co.","Meridian Components","Kinetix Industrial"].map((company,i)=>({id:`vendor-${i+1}`,company,code:`V-${i+1}`,contact:"Demo Contact",email:`vendor${i+1}@example.com`,score:String(94-i*3)}));
 const rfqs = ["Precision machined turbine components","Industrial safety equipment — Q3","High-tensile fasteners & fixings","Hydraulic pump assemblies","Electrical panel maintenance contract"].map((title,i)=>({id:`rfq-${i+1}`,number:`RFQ-202610-${String(42-i).padStart(4,"0")}`,title,reqId:`REQ-26-${1842-i}`,prNo:`PR-2026-${871-i}`,department:"Operations",template:"Standard RFQ",type:i===1?"PR Linked RFQ":"Direct RFQ",status:["Live","QCS Approved","Negotiation Scheduled","Quotations Received","Draft"][i],urgency:i%2?"Normal":"High",currency:"INR",project:"Kaveri Turbine Upgrade",client:"Northstar Energy",startAt:now(),endAt:new Date(Date.now()+86400000).toISOString(),freezeAt:now(),expectedStartAt:now(),incoTerms:"DDP",paymentTerms:"Net 45",deliveryTerms:"6 weeks",biddingType:"Reverse",aiScoring:true,createdAt:now(),updatedAt:now()}));
 const items = ["Turbine shaft assembly","Bearing housing, split type","Rotor blade set, stage 2"].map((name,i)=>({id:`item-${i+1}`,rfqId:"rfq-1",name,code:["TSA-4401","BHS-2180","RBS-7250"][i],partNo:`PT-${i+1}`,uom:"Each",qty:["24","48","12"][i],specs:"Industrial specification",targetPrice:null}));
 const bids:any[]=[];const quotes:any[]=[];
 vendors.forEach((vendor,i)=>{let initialTotal=0,finalTotal=0;items.forEach((item,j)=>{const unit=[18450,12680,39200][j]*(1+i*.035);const revised=unit*.93;initialTotal+=unit*Number(item.qty);finalTotal+=revised*Number(item.qty);if(i<3){bids.push({id:uid(),rfqId:"rfq-1",vendorId:vendor.id,itemId:item.id,unitPrice:unit.toFixed(2),kind:"initial",createdAt:new Date(Date.now()-3600000).toISOString()},{id:uid(),rfqId:"rfq-1",vendorId:vendor.id,itemId:item.id,unitPrice:revised.toFixed(2),kind:"revised",createdAt:now()});}});quotes.push({id:uid(),rfqId:"rfq-1",vendorId:vendor.id,status:i===3?"Pending":"Submitted",initialTotal:i===3?"0":initialTotal.toFixed(2),finalTotal:i===3?"0":finalTotal.toFixed(2),otherCharges:"0",rank:i===3?null:i+1,comment:null,updatedAt:now()});});
 return {rfqs,vendors,items,quotes,bids,auditLogs:[{id:uid(),rfqId:"rfq-1",actorId:"Demo Buyer",action:"Demo RFQ created",details:{},createdAt:now()}],comments:[],counterBids:[],purchaseOrders:[]};
}
// Firestore transaction ensures concurrent Vercel requests do not overwrite each other.
// This single-document model is suitable for a small demo only (Firestore 1 MiB/document limit).
export async function readStore():Promise<Store>{
 const snap=await storeRef().get();
 if(snap.exists)return snap.data() as Store;
 const seed=initial();
 try { await storeRef().create(seed); return seed; }
 catch { const latest=await storeRef().get(); if(latest.exists)return latest.data() as Store; throw new Error("Unable to initialize Firestore demo workspace"); }
}
export async function mutate<T>(fn:(s:Store)=>T|Promise<T>):Promise<T>{
 return adminDb().runTransaction(async tx=>{
   const ref=storeRef();
   const snap=await tx.get(ref);
   const store=snap.exists ? snap.data() as Store : initial();
   const result=await fn(store);
   tx.set(ref,store);
   return result;
 });
}
export function log(s:Store,rfqId:string,actorId:string,action:string,details:any={},reason?:string){s.auditLogs.unshift({id:uid(),rfqId,actorId,action,details,reason:reason??null,createdAt:now()});}
export function detail(s:Store,id:string){const rfq=s.rfqs.find(r=>r.id===id);if(!rfq)return null;const enrich=(x:any)=>({...x,vendor:s.vendors.find(v=>v.id===x.vendorId)??null,item:s.items.find(i=>i.id===x.itemId)??null});return {rfq,items:s.items.filter(x=>x.rfqId===id),quotes:s.quotes.filter(x=>x.rfqId===id).map(enrich),bids:s.bids.filter(x=>x.rfqId===id).map(enrich).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),auditLogs:s.auditLogs.filter(x=>x.rfqId===id),comments:s.comments.filter(x=>x.rfqId===id).map(enrich),counterBids:s.counterBids.filter(x=>x.rfqId===id).map(enrich),purchaseOrders:s.purchaseOrders};}
export function rank(s:Store,id:string){s.quotes.filter(q=>q.rfqId===id&&!["Pending","Rejected","Frozen"].includes(q.status)).sort((a,b)=>Number(a.finalTotal)-Number(b.finalTotal)).forEach((q,i)=>q.rank=i+1);}
