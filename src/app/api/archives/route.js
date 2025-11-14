import { NextResponse } from "next/server";
import clientPromise from "../../../lib/mongodb";
import { ObjectId } from "mongodb";

const DEFAULT_USER_ID = "local_user";

/**
 * GET /api/archives
 * - List user's archives (no query param)
 * - Read single archive: ?id=<archiveId>
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id") || null;

    const client = await clientPromise;
    const db = client.db("planterbox");
    const col = db.collection("archives");

    if (id) {
      // single archive
      const archive = await col.findOne({
        _id: new ObjectId(id),
        userId: DEFAULT_USER_ID,
      });
      if (!archive) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json({ archive }, { status: 200 });
    }

    // list archives (most recent first). Project a minimal shape for cards.
    const archives = await col
      .find({ userId: DEFAULT_USER_ID })
      .project({
        plantName: 1,
        finalStage: 1,
        startDate: 1,
        endDate: 1,
        stats: 1,
        // Uncomment to include a cover in the list view:
        // "snapshots.temperature": 1,
      })
      .sort({ endDate: -1 })
      .toArray();

    return NextResponse.json({ archives }, { status: 200 });
  } catch (err) {
    console.error("GET /api/archives error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 200 });
  }
}

/**
 * DELETE /api/archives
 * - Delete a single archive: ?id=<archiveId>
 * - Optional bulk delete (dangerous): ?all=true
 *   (only if you want to expose it; it deletes all user's archives)
 *
 * This only deletes the archive document(s). Your sensordata is already cleared on abort.
 * If in future you store external files (e.g., GridFS), delete them here too.
 */
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const all = searchParams.get("all") === "true";

    const client = await clientPromise;
    const db = client.db("planterbox");
    const col = db.collection("archives");

    if (all) {
      const result = await col.deleteMany({ userId: DEFAULT_USER_ID });
      return NextResponse.json({ ok: true, deletedCount: result.deletedCount }, { status: 200 });
    }

    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    let _id;
    try {
      _id = new ObjectId(id);
    } catch {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const result = await col.deleteOne({ _id, userId: DEFAULT_USER_ID });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, deletedCount: 1 }, { status: 200 });
  } catch (err) {
    console.error("DELETE /api/archives error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 200 });
  }
}