import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import clientPromise from '../../../lib/mongodb';
import { auth } from '../auth/[...nextauth]/route';

export async function GET(request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    const client = await clientPromise;
    const db = client.db('planterbox');
    const col = db.collection('archives');

    if (id) {
      const doc = await col.findOne({ _id: new ObjectId(id), userId: session.user.id });
      if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json({ archive: doc }, { status: 200 });
    }

    // List most recent first, light payload for cards
    const list = await col.find({ userId: session.user.id })
      .project({
        plantName: 1, finalStage: 1, startDate: 1, endDate: 1,
        stats: 1, snapshots: { $cond: [{ $gt: ["$snapshots", null] }, true, false] }
      })
      .sort({ endDate: -1 })
      .toArray();

    return NextResponse.json({ archives: list }, { status: 200 });
  } catch (e) {
    console.error('GET /api/archives error:', e);
    return NextResponse.json({ error: 'Failed to fetch archives' }, { status: 500 });
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
