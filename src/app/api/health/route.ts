import {readStore} from "@/lib/demo-store";
export const dynamic="force-dynamic";
export async function GET(){try{const s=await readStore();return Response.json({ok:true,mode:"local-demo",rfqs:s.rfqs.length});}catch{return Response.json({ok:false},{status:500});}}
