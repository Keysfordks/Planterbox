'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Card, Modal, Typography, Tag, Statistic, Row, Col, Skeleton, Empty, Space, Button } from 'antd';
import { CalendarOutlined, LineChartOutlined, ReloadOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

/**
 * PastGrowsGrid
 * - Renders a grid of archived grows (GET /api/archives)
 * - Click a card to view details (snapshots + stats)
 */
export default function PastGrowsGrid() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(null); // currently selected archive (full doc)

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

  // Initial load
  useEffect(() => {
    loadArchives();
  }, []);

  const onOpenDetails = async (id) => {
    try {
      const res = await fetch(`/api/archives?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`GET /api/archives?id=... failed: ${res.status}`);
      const json = await res.json();
      setActive(json?.archive ?? null);
    } catch (e) {
      console.error(e);
    }
  };

  const gridCols = useMemo(() => ({
    xs: 1, sm: 2, md: 2, lg: 3, xl: 4, xxl: 4
  }), []);

  return (
    <div style={{ padding: 16 }}>
      <Space align="center" style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }}>
        <Title level={4} style={{ margin: 0 }}>
          <LineChartOutlined style={{ marginRight: 8 }} />
          Past Grows
        </Title>
        <Button icon={<ReloadOutlined />} onClick={() => loadArchives({ force: true })} loading={refreshing}>
          Refresh
        </Button>
      </Space>

      {error && (
        <div style={{ color: 'crimson', marginBottom: 12 }}>{error}</div>
      )}

      {/* Loading skeletons */}
      {loading ? (
        <Row gutter={[16, 16]}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Col key={i} xs={24} sm={12} md={12} lg={8} xl={6}>
              <Card>
                <Skeleton active avatar paragraph={{ rows: 4 }} />
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
            <Col key={it._id} xs={24} sm={12} md={12} lg={8} xl={6}>
              <ArchiveCard item={it} onOpen={() => onOpenDetails(it._id)} />
            </Col>
          ))}
        </Row>
      )}

      <ArchiveDetailsModal archive={active} onClose={() => setActive(null)} />
    </div>
  );
}

/** Single archive card */
function ArchiveCard({ item, onOpen }) {
  const coverUrl = item?.snapshots ? item.snapshots : null; // in list API we projected boolean; if true, fetch detail shows real images
  // Try to use temperature snapshot preview when you navigate into the detail modal;
  // The list endpoint only returns a boolean flag for snapshots to keep payloads small.

  const start = item?.startDate ? new Date(item.startDate) : null;
  const end = item?.endDate ? new Date(item.endDate) : null;

  const period = (
    <Space size={6}>
      <CalendarOutlined />
      <Text type="secondary">
        {start ? start.toLocaleDateString() : '—'} – {end ? end.toLocaleDateString() : '—'}
      </Text>
    </Space>
  );

  const stats = item?.stats;

  return (
    <Card
      hoverable
      onClick={onOpen}
      cover={
        <div style={{ height: 160, background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {/* We don’t have the actual image data in list view; show a tasteful placeholder */}
          <Text type="secondary" style={{ fontSize: 12 }}>Click to view snapshots</Text>
        </div>
      }
      bodyStyle={{ padding: 12 }}
    >
      <Space direction="vertical" size={6} style={{ width: '100%' }}>
        <Space align="baseline" style={{ justifyContent: 'space-between', width: '100%' }}>
          <Text style={{ fontWeight: 600 }}>{item?.plantName || 'Unknown Plant'}</Text>
          <Tag color="blue">{item?.finalStage || '—'}</Tag>
        </Space>
        {period}
        {stats ? (
          <Row gutter={8} style={{ marginTop: 8 }}>
            <Col span={12}>
              <MiniStat title="Temp avg" value={fmt(stats.temperature?.avg, '°C')} />
            </Col>
            <Col span={12}>
              <MiniStat title="Humidity avg" value={fmt(stats.humidity?.avg, '%')} />
            </Col>
            <Col span={12}>
              <MiniStat title="pH avg" value={fmt(stats.ph?.avg, '')} />
            </Col>
            <Col span={12}>
              <MiniStat title="PPM avg" value={fmt(stats.ppm?.avg, '')} />
            </Col>
          </Row>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>No stats computed</Text>
        )}
      </Space>
    </Card>
  );
}

function MiniStat({ title, value }) {
  return (
    <div style={{ background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8, padding: 10, height: '100%' }}>
      <Text type="secondary" style={{ fontSize: 12 }}>{title}</Text>
      <div style={{ fontWeight: 600, fontSize: 14 }}>{value}</div>
    </div>
  );
}

/** Details modal (loads full doc including snapshots via parent) */
function ArchiveDetailsModal({ archive, onClose }) {
  const open = Boolean(archive);
  if (!open) return null;

  const a = archive;

  const start = a?.startDate ? new Date(a.startDate) : null;
  const end = a?.endDate ? new Date(a.endDate) : null;

  const shots = a?.snapshots || {};
  const imgStyle = { width: '100%', border: '1px solid #eee', borderRadius: 8 };

  return (
    <Modal
      title={a?.plantName || 'Archived Grow'}
      open={open}
      onCancel={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
      width={1000}
      destroyOnClose={false}
      maskClosable={false}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space size={8} wrap>
          <Tag color="blue">{a?.finalStage || '—'}</Tag>
          <Tag icon={<CalendarOutlined />} color="default">
            {start ? start.toLocaleString() : '—'} — {end ? end.toLocaleString() : '—'}
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

        {/* Snapshots */}
        {(shots.temperature || shots.humidity || shots.ppm || shots.ph) ? (
          <>
            <Title level={5} style={{ marginTop: 8 }}>Snapshots</Title>
            <Row gutter={[12, 12]}>
              {shots.temperature && <Col xs={24} md={12}><img src={shots.temperature} alt="Temperature" style={imgStyle} /></Col>}
              {shots.humidity && <Col xs={24} md={12}><img src={shots.humidity} alt="Humidity" style={imgStyle} /></Col>}
              {shots.ppm && <Col xs={24} md={12}><img src={shots.ppm} alt="PPM" style={imgStyle} /></Col>}
              {shots.ph && <Col xs={24} md={12}><img src={shots.ph} alt="pH" style={imgStyle} /></Col>}
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
    <div style={{ background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8, padding: 12 }}>
      <Text type="secondary">{title}</Text>
      <Row gutter={8} style={{ marginTop: 6 }}>
        <Col span={8}><Statistic title="Min" value={min} valueStyle={{ fontSize: 16 }} /></Col>
        <Col span={8}><Statistic title="Avg" value={avg} valueStyle={{ fontSize: 16 }} /></Col>
        <Col span={8}><Statistic title="Max" value={max} valueStyle={{ fontSize: 16 }} /></Col>
      </Row>
    </div>
  );
}

/* helpers */
function fmt(v, unit) {
  if (v == null || Number.isNaN(v)) return '—';
  const n = typeof v === 'number' ? v : Number(v);
  const s = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return unit ? `${s} ${unit}` : s;
}
