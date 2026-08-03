import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ error: "Select a saved project and use Export internal CSV from its Costing tab." }, { status: 410 });
}
