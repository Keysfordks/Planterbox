'use client';

import { useState } from 'react';
import { Card, Tag, Button, Modal, message } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import styles from '../styles/plantcard.module.css';

export default function PlantCard({ plant, onDelete }) {
  const { _id, plant_name, stage, ideal_conditions } = plant;
  const [deleting, setDeleting] = useState(false);

  const getStageColor = (stage) => {
    const colors = {
      seedling: 'green',
      vegetative: 'blue',
      flowering: 'purple',
      mature: 'orange',
      harvest: 'gold',
    };
    return colors[stage?.toLowerCase()] || 'default';
  };

  // Safely access nested values with fallbacks
  const conditions = ideal_conditions || {};
  const phMin = conditions.ph_min || 'N/A';
  const phMax = conditions.ph_max || 'N/A';
  const ppmMin = conditions.ppm_min || 'N/A';
  const ppmMax = conditions.ppm_max || 'N/A';
  const tempMin = conditions.temp_min || 'N/A';
  const tempMax = conditions.temp_max || 'N/A';
  const humidityMin = conditions.humidity_min || 'N/A';
  const humidityMax = conditions.humidity_max || 'N/A';

  const handleAbortPlant = () => {
    Modal.confirm({
      title: 'Abort Plant Profile?',
      icon: <ExclamationCircleOutlined />,
      content: `Are you sure you want to delete the ${plant_name} (${stage}) profile? This action cannot be undone.`,
      okText: 'Yes, Delete',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          setDeleting(true);
          const response = await fetch(`/api/plants?id=${_id}`, {
            method: 'DELETE',
          });

          if (!response.ok) {
            throw new Error('Failed to delete plant');
          }

          message.success(`${plant_name} profile deleted successfully`);
          
          if (onDelete) {
            onDelete();
          }
        } catch (error) {
          console.error('Error deleting plant:', error);
          message.error('Failed to delete plant profile');
        } finally {
          setDeleting(false);
        }
      },
    });
  };

  return (
    <div className={styles.plantCard}>
      <div className={styles.cardHeader}>
        <h2 className={styles.plantTitle}>
          {plant_name.charAt(0).toUpperCase() + plant_name.slice(1)}
        </h2>
        <Tag color={getStageColor(stage)} className={styles.stageTag}>
          {stage.toUpperCase()}
        </Tag>
      </div>

      <div className={styles.sensorsGrid}>
        {/* Temperature */}
        <div className={styles.sensorBox}>
          <h3 className={styles.sensorTitle}>Temperature (°C)</h3>
          <div className={styles.sensorValue}>Loading...</div>
          <p className={styles.sensorIdeal}>Ideal: {tempMin}°C – {tempMax}°C</p>
        </div>

        {/* Humidity */}
        <div className={styles.sensorBox}>
          <h3 className={styles.sensorTitle}>Humidity (%)</h3>
          <div className={styles.sensorValue}>Loading...</div>
          <p className={styles.sensorIdeal}>Ideal: {humidityMin}% – {humidityMax}%</p>
        </div>

        {/* pH Level */}
        <div className={styles.sensorBox}>
          <h3 className={styles.sensorTitle}>pH Level</h3>
          <div className={styles.sensorValue}>Loading...</div>
          <p className={styles.sensorIdeal}>Ideal: {phMin} – {phMax}</p>
        </div>

        {/* PPM */}
        <div className={styles.sensorBox}>
          <h3 className={styles.sensorTitle}>PPM (Nutrients)</h3>
          <div className={styles.sensorValue}>Loading...</div>
          <p className={styles.sensorIdeal}>Ideal: {ppmMin} – {ppmMax}</p>
        </div>

        {/* Water Level */}
        <div className={styles.sensorBox}>
          <h3 className={styles.sensorTitle}>Water Level</h3>
          <div className={styles.sensorValue}>TOO LOW</div>
          <p className={styles.sensorIdeal}>Ideal: Sufficient</p>
        </div>
      </div>

      <div className={styles.cardFooter}>
        <Button 
          danger 
          size="large"
          loading={deleting}
          onClick={handleAbortPlant}
        >
          {deleting ? 'Deleting...' : 'Abort Plant'}
        </Button>
      </div>
    </div>
  );
}