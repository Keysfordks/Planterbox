import { NextResponse } from "next/server";
import clientPromise from "../../../lib/mongodb";
import { auth } from "../auth/[...nextauth]/route";
import { ObjectId } from "mongodb";

export async function GET(request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const userId = session.user.id;
    const client = await clientPromise;
    const db = client.db("planterbox");
    const archives = db.collection("archives");
    const profiles = db.collection("plant_profiles");

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const detail = searchParams.get("detail") === "true";

    if (projectId) {
      let _id = null;
      try { _id = new ObjectId(projectId); } catch {}
      const project = _id ? await archives.findOne({ _id, userId }) : null;

      if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

      if (!detail) {
        return NextResponse.json({ project }, { status: 200 });
      }

      // Optionally fetch ideal conditions for the plant at final stage
      const profile = await profiles.findOne(
        {
          plant_name: project.plantName,
          stage: project.finalStage,
          $or: [{ userId }, { userId: { $exists: false } }]
        },
        { sort: { userId: -1 } }
      );

      return NextResponse.json({
        project,
        idealConditions: profile?.ideal_conditions ?? null
      }, { status: 200 });
    }

    // List all projects
    const list = await archives
      .find({ userId })
      .sort({ endDate: -1 })
      .project({ plantName: 1, finalStage: 1, startDate: 1, endDate: 1 })
      .toArray();

    return NextResponse.json({ projects: list }, { status: 200 });
  } catch (err) {
    console.error("GET /api/archives error:", err);
    return NextResponse.json({ error: "Failed to fetch archives" }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const userId = session.user.id;
    const client = await clientPromise;
    const db = client.db("planterbox");
    const archives = db.collection("archives");

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    if (!projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });

    const _id = new ObjectId(projectId);

    const res = await archives.deleteOne({ _id, userId });
    if (res.deletedCount === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("DELETE /api/archives error:", err);
    return NextResponse.json({ error: "Failed to delete archive" }, { status: 500 });
  }
}
