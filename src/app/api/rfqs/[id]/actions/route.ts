import {NextRequest} from "next/server";
import {mutate,uid,log,rank} from "@/lib/demo-store";
export const dynamic="force-dynamic";
type C={params:Promise<{id:string}>};
export async function POST(request:NextRequest,c:C){const {id}=await c.params;const b=await request.json();const action=String(b.action??"");return mutate(s=>{const r=s.rfqs.find(r=>r.id===id);if(!r)return Response.json({error:"RFQ not found"},{status:404});const actor=b.actor??"Demo Buyer";const quote=s.quotes.find(q=>q.rfqId===id&&q.vendorId===b.vendorId);let result:any={ok:true};
if(action==="counter-bid"){if(!b.comment||!(b.items??[]).length)return Response.json({error:"Comment and items required"},{status:400});const recipients=b.applyToAll?s.quotes.filter(q=>q.rfqId===id):quote?[quote]:[];const version=Math.max(0,...s.counterBids.filter(x=>x.rfqId===id).map(x=>x.version))+1;for(const q of recipients)for(const item of b.items)s.counterBids.push({id:uid(),rfqId:id,vendorId:q.vendorId,itemId:item.itemId,version,unitPrice:String(item.unitPrice),comment:b.comment,status:"Sent",createdBy:actor,createdAt:new Date().toISOString()});result={ok:true,version,saved:recipients.length*b.items.length};}
else if(action==="approve-quote"||action==="approve-all"){if(!quote)return Response.json({error:"Vendor not found"},{status:404});quote.status=b.status??"Approved";rank(s,id);result={ok:true,status:quote.status};}
else if(action==="submit-bid"){if(!quote)return Response.json({error:"Vendor not found"},{status:404});for(const item of b.items??[]){s.bids.push({id:uid(),rfqId:id,vendorId:b.vendorId,itemId:item.itemId,unitPrice:String(item.unitPrice),kind:"revised",createdAt:new Date().toISOString()});}quote.status="Submitted";quote.finalTotal=String(s.items.filter(i=>i.rfqId===id).reduce((sum,i)=>{const bids=s.bids.filter(x=>x.rfqId===id&&x.vendorId===b.vendorId&&x.itemId===i.id);return sum+Number(i.qty)*Number(bids[bids.length-1]?.unitPrice??0);},Number(quote.otherCharges??0)));rank(s,id);}
else if(action==="rollback"){if(!b.reason)return Response.json({error:"Rollback reason required"},{status:400});for(const item of b.items??[]){const old=s.bids.find(x=>x.id===item.bidId&&x.rfqId===id&&x.vendorId===b.vendorId);if(old)s.bids.push({...old,id:uid(),kind:"rollback",createdAt:new Date().toISOString()});}}
else if(action==="comment"){if(!b.message)return Response.json({error:"Comment required"},{status:400});s.comments.push({id:uid(),rfqId:id,vendorId:b.vendorId??null,message:b.message,actorId:actor,createdAt:new Date().toISOString()});}
else if(action==="freeze-vendor"){if(!quote)return Response.json({error:"Vendor not found"},{status:404});quote.status="Frozen";}
else if(action==="convert-auction"){r.type="Live Auctions";r.biddingType="Reverse";r.status="Live";}
else if(action==="restart"){r.status="Live";}
else if(action==="close"){r.status="Negotiation Ended";}
else if(action==="save-settings"){Object.assign(r,b.settings??{});}
else if(action==="save-cap"){for(const entry of b.items??[]){const item=s.items.find(i=>i.id===entry.itemId&&i.rfqId===id);if(item)item.priceCap=entry.unitPrice;}}
else if(action==="save-counter-target"){for(const entry of b.items??[]){const item=s.items.find(i=>i.id===entry.itemId&&i.rfqId===id);if(item)item.targetPrice=entry.unitPrice;}}
else if(!["remind","surrogate"].includes(action))return Response.json({error:`Unsupported action: ${action}`},{status:400});
log(s,id,actor,action,b,b.reason??b.comment);return Response.json(result);});}
