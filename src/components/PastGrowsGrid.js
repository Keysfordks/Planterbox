'use client';

import React, { useEffect, useState } from 'react';
import {
  Card, Modal, Typography, Tag, Statistic, Row, Col, Skeleton,
  Empty, Space, Button, Divider, Popconfirm, message
} from 'antd';
import {
  CalendarOutlined, LineChartOutlined, ReloadOutlined, DeleteOutlined
} from '@ant-design/icons';

const { Title, Text } = Typography;

export default function PastGrowsGrid() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(null);

  async function loadArchives({ force } = {}) {
    try {
      if (loading || force) setRefreshing(true);
      setError(null);
      const res = await fetch('/api/archives', { cache: 'no-store' });
      if (!res.ok) throw new Error(`GET /api/archives failed: ${res.status}`);
      const json = await res.json();
      setItems(Array.isArray(json?.archives) ? json.archives : []);
    } catch (e) {
      console.error(e);
      setError(e.message || 'Failed to load archives');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { loadArchives(); }, []);

  const onOpenDetails = async (id) => {
    try {
      const res = await fetch(`/api/archives?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`GET /api/archives?id=... failed: ${res.status}`);
      const json = await res.json();
      setActive(json?.archive ?? null);
    } catch (e) {
      console.error(e);
      message.error('Failed to open archive');
    }
  };

  const onDelete = async (id) => {
    try {
      const res = await fetch(`/api/archives?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(msg || `Delete failed (${res.status})`);
      }
      setItems((prev) => prev.filter((x) => x._id !== id)); // remove from list
      setActive((prev) => (prev?._id === id ? null : prev)); // close modal if open
      message.success('Archive deleted');
    } catch (e) {
      console.error(e);
      message.error('Could not delete archive');
    }
  };

  return (
    <div style={{ padding: 0 }}>
      <Space align="center" style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }}>
        <Title level={4} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <LineChartOutlined />
          Past Grows
        </Title>
        <Button icon={<ReloadOutlined />} onClick={() => loadArchives({ force: true })} loading={refreshing}>
          Refresh
        </Button>
      </Space>

      {error && <div style={{ color: 'crimson', marginBottom: 12 }}>{error}</div>}

      {loading ? (
        <Row gutter={[16, 16]}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Col key={i} xs={24} lg={12}>
              <Card style={{ borderRadius: 14 }}>
                <div style={{ display: 'flex', gap: 16 }}>
                  <Skeleton.Image style={{ width: 220, height: 140, borderRadius: 10 }} />
                  <div style={{ flex: 1 }}>
                    <Skeleton active paragraph={{ rows: 3 }} />
                  </div>
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      ) : items.length === 0 ? (
        <Empty
          description={
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>No archives yet</div>
              <Text type="secondary">Abort a plant to save its history here.</Text>
            </div>
          }
          style={{ padding: '48px 0' }}
        />
      ) : (
        <Row gutter={[16, 16]}>
          {items.map((it) => (
            <Col key={it._id} xs={24} lg={12}>
              <ArchiveCardHorizontal
                item={it}
                onOpen={() => onOpenDetails(it._id)}
                onDelete={onDelete}
              />
            </Col>
          ))}
        </Row>
      )}

      <ArchiveDetailsModal
        archive={active}
        onClose={() => setActive(null)}
        onDelete={onDelete}
      />
    </div>
  );
}

/* ---------- HORIZONTAL CARD WITH ROW-LEVEL DELETE ---------- */

function ArchiveCardHorizontal({ item, onOpen, onDelete }) {
  const start = toDate(item?.startDate);
  const end = toDate(item?.endDate);
  const stage = (item?.finalStage || '—').toLowerCase();
  const name = niceName(item?.plantName || 'Unknown Plant');
  const stats = item?.stats;

  // const cover = item?.snapshots?.temperature; // If you projected it in GET list
  const cover = null;

  // stop card click when pressing delete
  const handleDeleteClick = async (e) => {
    e.stopPropagation();
    // confirmed in Popconfirm
  };

  return (
    <Card
      hoverable
      onClick={onOpen}
      style={{ borderRadius: 14 }}
      bodyStyle={{ padding: 14 }}
    >
      <div style={{ display: 'flex', gap: 16, alignItems: 'stretch' }}>
        {/* LEFT: thumbnail */}
        <div style={{ width: 220, minWidth: 220, position: 'relative' }}>
          {cover ? (
            <img
              src={cover}
              alt="Snapshot"
              style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 10, border: '1px solid #eee' }}
            />
          ) : (
            <CoverPlaceholder />
          )}

          {/* Stage chip */}
          <div style={{ position: 'absolute', top: 8, right: 8 }}>
            <Tag color="blue" style={{ borderRadius: 999 }}>{stage}</Tag>
          </div>
        </div>

        {/* RIGHT: details */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <Text style={{ fontWeight: 600, fontSize: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {name}
            </Text>

            <Space size={8} align="center">
              <Space size={6} style={{ color: '#6b7280', whiteSpace: 'nowrap' }}>
                <CalendarOutlined />
                <span>{fmtDate(start)} — {fmtDate(end)}</span>
              </Space>

              {/* Row-level delete icon */}
              <Popconfirm
                title="Delete this archive?"
                description="This will permanently delete the archived plant and its stored snapshots."
                okText="Delete"
                okType="danger"
                onConfirm={() => onDelete(item._id)}
              >
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={handleDeleteClick}
                  aria-label="Delete archive"
                />
              </Popconfirm>
            </Space>
          </div>

          <Divider style={{ margin: '8px 0' }} />

          {stats ? (
            <Row gutter={[8, 8]}>
              <Col xs={12} md={6}><MiniStat title="Temp avg" value={fmt(stats.temperature?.avg, '°C')} /></Col>
              <Col xs={12} md={6}><MiniStat title="Humidity avg" value={fmt(stats.humidity?.avg, '%')} /></Col>
              <Col xs={12} md={6}><MiniStat title="pH avg" value={fmt(stats.ph?.avg, '')} /></Col>
              <Col xs={12} md={6}><MiniStat title="PPM avg" value={fmt(stats.ppm?.avg, '')} /></Col>
            </Row>
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>No stats computed</Text>
          )}
        </div>
      </div>
    </Card>
  );
}

function MiniStat({ title, value }) {
  return (
    <div style={{
      background: '#fafafa',
      border: '1px solid #f0f0f0',
      borderRadius: 10,
      padding: 10,
      height: '100%'
    }}>
      <Text type="secondary" style={{ fontSize: 12 }}>{title}</Text>
      <div style={{ fontWeight: 600, fontSize: 14, marginTop: 4 }}>{value}</div>
    </div>
  );
}

/* ---------- DETAILS MODAL (also keeps Delete) ---------- */

function ArchiveDetailsModal({ archive, onClose, onDelete }) {
  const open = Boolean(archive);
  if (!open) return null;

  const a = archive;
  const start = toDate(a?.startDate);
  const end = toDate(a?.endDate);
  const name = niceName(a?.plantName || 'Archived Grow');
  const shots = a?.snapshots || {};
  const imgStyle = { width: '100%', border: '1px solid #eee', borderRadius: 10 };

  return (
    <Modal
      title={name}
      open={open}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>Close</Button>
          <Popconfirm
            title="Delete this archive?"
            description="This will permanently delete the archived plant and its stored snapshots."
            okText="Delete"
            okType="danger"
            onConfirm={() => onDelete(a._id)}
          >
            <Button danger icon={<DeleteOutlined />}>Delete</Button>
          </Popconfirm>
        </Space>
      }
      width={1000}
      destroyOnClose={false}
      maskClosable={false}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space size={8} wrap>
          <Tag color="blue">{(a?.finalStage || '—').toLowerCase()}</Tag>
          <Tag icon={<CalendarOutlined />} color="default">
            {fmtDateTime(start)} — {fmtDateTime(end)}
          </Tag>
          {a?.stats?.samples != null && <Tag>Samples: {a.stats.samples}</Tag>}
        </Space>

        {a?.stats && (
          <Row gutter={[12, 12]}>
            <Col xs={12} sm={6}><StatBlock title="Temp (°C)" stat={a.stats.temperature} fmtUnit="°C" /></Col>
            <Col xs={12} sm={6}><StatBlock title="Humidity (%)" stat={a.stats.humidity} fmtUnit="%" /></Col>
            <Col xs={12} sm={6}><StatBlock title="pH" stat={a.stats.ph} fmtUnit="" /></Col>
            <Col xs={12} sm={6}><StatBlock title="PPM" stat={a.stats.ppm} fmtUnit="" /></Col>
          </Row>
        )}

        {(shots.temperature || shots.humidity || shots.ppm || shots.ph) ? (
          <>
            <Title level={5} style={{ marginTop: 8 }}>Snapshots</Title>
            <Row gutter={[12, 12]}>
              {shots.temperature && <Col xs={24} md={12}><img src={shots.temperature} alt="Temperature" style={imgStyle} /></Col>}
              {shots.humidity   && <Col xs={24} md={12}><img src={shots.humidity} alt="Humidity" style={imgStyle} /></Col>}
              {shots.ppm        && <Col xs={24} md={12}><img src={shots.ppm} alt="PPM" style={imgStyle} /></Col>}
              {shots.ph         && <Col xs={24} md={12}><img src={shots.ph} alt="pH" style={imgStyle} /></Col>}
            </Row>
          </>
        ) : (
          <Text type="secondary">No snapshots stored for this grow.</Text>
        )}
      </Space>
    </Modal>
  );
}

function StatBlock({ title, stat, fmtUnit }) {
  const min = fmt(stat?.min, fmtUnit);
  const max = fmt(stat?.max, fmtUnit);
  const avg = fmt(stat?.avg, fmtUnit);

  return (
    <div style={{ background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 10, padding: 12 }}>
      <Text type="secondary">{title}</Text>
      <Row gutter={8} style={{ marginTop: 6 }}>
        <Col span={8}><Statistic title="Min" value={min} valueStyle={{ fontSize: 16 }} /></Col>
        <Col span={8}><Statistic title="Avg" value={avg} valueStyle={{ fontSize: 16 }} /></Col>
        <Col span={8}><Statistic title="Max" value={max} valueStyle={{ fontSize: 16 }} /></Col>
      </Row>
    </div>
  );
}

/* ---------- helpers ---------- */

function fmt(v, unit) {
  if (v == null || Number.isNaN(v)) return '—';
  const n = typeof v === 'number' ? v : Number(v);
  const s = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return unit ? `${s} ${unit}` : s;
}
function toDate(d) { try { return d ? new Date(d) : null; } catch { return null; } }
function fmtDate(d) { return d ? d.toLocaleDateString() : '—'; }
function fmtDateTime(d) { return d ? d.toLocaleString() : '—'; }
function niceName(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

function CoverPlaceholder() {
  return (
    <div
      style={{
        width: '100%',
        height: 140,
        display: 'grid',
        placeItems: 'center',
        background: 'linear-gradient(135deg, rgba(16,185,129,0.15) 0%, rgba(59,130,246,0.15) 100%)',
        borderRadius: 10,
        border: '1px solid #eee'
      }}
    >
      <div
        style={{
          padding: '6px 10px',
          background: 'rgba(255,255,255,0.75)',
          border: '1px solid rgba(0,0,0,0.06)',
          borderRadius: 999
        }}
      >
        <Text type="secondary" style={{ fontSize: 12 }}>Click to view snapshots</Text>
      </div>
    </div>
  );
}
