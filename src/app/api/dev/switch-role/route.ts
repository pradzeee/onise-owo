import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Dev switcher has been permanently removed." },
    { status: 404 },
  );
}
