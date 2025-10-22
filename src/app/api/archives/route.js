import { NextResponse } from "next/server";
import clientPromise from "../../../lib/mongodb";
import { auth } from "../../auth/[...nextauth]/route";

// GET handler: Fetches a list of all archived projects for the user.
export async function GET() {
  const session = await auth();
  if (!session || !session.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const client = await clientPromise;
    const db = client.db("planterbox");
    const collection = db.collection("archived_projects");

    // Fetch only the necessary fields for the list view
    const projects = await collection
      .find({ userId: session.user.id })
      .project({ 
        _id: 1, 
        plantName: 1, 
        startDate: 1, 
        endDate: 1, 
        finalStage: 1 
      })
      .sort({ endDate: -1 }) // Show most recent archives first
      .toArray();

    return NextResponse.json({ projects });

  } catch (error) {
    console.error("Error fetching archives:", error);
    return NextResponse.json({ error: "Failed to fetch archive list" }, { status: 500 });
  }
}

// DELETE handler: Deletes a specific archived project.
export async function DELETE(request) {
  const session = await auth();
  if (!session || !session.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json({ error: "Missing project ID" }, { status: 400 });
  }

  try {
    const client = await clientPromise;
    const db = client.db("planterbox");
    const collection = db.collection("archived_projects");

    const result = await collection.deleteOne({ 
      _id: new ObjectId(projectId), // Assuming you use ObjectId
      userId: session.user.id // Security check
    });

    if (result.deletedCount === 0) {
      return NextResponse.json({ message: "Project not found or not authorized" }, { status: 404 });
    }

    // NOTE: We do NOT delete sensor_data here. Sensor data is kept for historical context 
    // and is filtered by date/user ID when requested.

    return NextResponse.json({ message: "Archived project deleted successfully" });

  } catch (error) {
    console.error("Error deleting archive:", error);
    return NextResponse.json({ error: "Failed to delete archived project" }, { status: 500 });
  }
}