import pool from "@/lib/db";
import {NextResponse , NextRequest} from "next/server"

// type PersmissonContext = {
//     permission : Promise<{permissionId : string}>
// }

export async function GET() {
    try {

       const result = await pool.query("SELECT * FROM permission")

       if (result.rowCount === 0) {
        return NextResponse.json({message : "No permissons are added yet"},{status : 404})
       }

       return NextResponse.json({message : "Listing all the permissios",permissions : result.rows},{status : 200})

    } catch(error : unknown) {
        return NextResponse.json({message : "Getting the Permissions Failed"},{status : 400})
    }
}

export async function POST(request : NextRequest){

    let body : unknown;

    try {

        body = await request.json();        
        
    } catch (error : unknown) {
        return NextResponse.json({message  : "The body should be proper JSON object"},{status : 404})
    }

    

}