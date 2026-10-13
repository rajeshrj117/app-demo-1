import {NextRequest} from "next/server";
import {readStore,mutate,detail,log} from "@/lib/demo-store";
export const dynamic="force-dynamic";
type C={params:Promise<{id:string}>};
export async function GET(_r:NextRequest,c:C){const {id}=await c.params;const d=detail(await readStore(),id);return d?Response.json(d):Response.json({error:"RFQ not found"},{status:404});}
export async function PATCH(request:NextRequest,c:C){const {id}=await c.params;const body=await request.json();const rfq=await mutate(s=>{const r=s.rfqs.find(r=>r.id===id);if(!r)return null;for(const key of ["status","title","urgency","endAt","startAt","freezeAt","currency","biddingType"])if(key in body)r[key]=body[key];r.updatedAt=new Date().toISOString();log(s,id,body.actor??"Demo Buyer",body.action??"RFQ updated",body.details??body,body.reason);return r;});return rfq?Response.json({rfq}):Response.json({error:"Not found"},{status:404});}
export async function DELETE(_r:NextRequest,c:C){const {id}=await c.params;const ok=await mutate(s=>{const r=s.rfqs.find(r=>r.id===id&&r.status==="Draft");if(!r)return false;r.status="Archived";log(s,id,"Demo Buyer","Draft RFQ archived");return true;});return ok?Response.json({ok:true}):Response.json({error:"Only draft RFQs can be deleted"},{status:409});}
