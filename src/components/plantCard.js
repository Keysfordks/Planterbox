'use client';

import { Card, Tag, Button } from 'antd';
import styles from '../styles/plantcard.module.css';

export default function PlantCard({ plant }) {
  const { plant_name, stage, ideal_conditions } = plant;

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

  return (
    <div className={styles.plantCard}>
      <div className={styles.cardHeader}>
        <h2 className={styles.plantTitle}>
          {plant_name.charAt(0).toUpperCase() + plant_name.slice(1)} - {stage.charAt(0).toUpperCase() + stage.slice(1)}
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
        <Button danger size="large">
          Abort Plant
        </Button>
      </div>
    </div>
  );
}