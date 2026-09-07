import { NextResponse } from "next/server";
import pool from "@/lib/db";

 export async function GET() {
 try {
     const result = await pool.query("SELECT 1");

     console.log(result);

     if(result.rows.length > 0){
        return NextResponse.json({status : "all connections ready"},{status : 200})
     }
     else { 
        return NextResponse.json({message : "DATABASE DIDNT RETURN 1 TO THE QUERRY"},{status : 503})
     }
    
 } catch (error : unknown) {
    return NextResponse.json({message : "The system is not yet Ready"},{status : 503 })
 }
}