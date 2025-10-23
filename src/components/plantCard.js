'use client';

import { useState } from 'react';
import { Card, Tag, Button, Modal, message } from 'antd';
import { ExclamationCircleOutlined, CheckCircleOutlined } from '@ant-design/icons';
import styles from '../styles/plantcard.module.css';

export default function PlantCard({ plant, onDelete, onSelect }) { // Added onSelect prop
  const { _id, plant_name, stage, ideal_conditions } = plant;
  const [deleting, setDeleting] = useState(false);
  const [selecting, setSelecting] = useState(false); // State for the new Select Plant button

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
  
  // --- NEW FUNCTION: Selects the plant profile for the device (Writes to app_state) ---
  const handleSelectPlant = () => {
    Modal.confirm({
      title: 'Start Grow Cycle?',
      icon: <CheckCircleOutlined />,
      content: `Are you sure you want to start a new grow cycle with ${plant_name} (${stage})? This will override any current selection.`,
      okText: 'Yes, Start Grow',
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          setSelecting(true);
          
          // CRITICAL: Post to /api/sensordata with the required action and data
          const response = await fetch('/api/sensordata', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              action: 'select_plant', // REQUIRED for the sensordata API to process it
              selectedPlant: plant_name,
              selectedStage: stage,
            }),
          });

          if (!response.ok) {
            throw new Error('Failed to select plant');
          }

          message.success(`Grow cycle started for ${plant_name}!`);
          
          if (onSelect) { // Optional callback to refresh the dashboard
            onSelect();
          }

        } catch (error) {
          console.error('Error selecting plant:', error);
          message.error('Failed to start grow cycle.');
        } finally {
          setSelecting(false);
        }
      },
    });
  };

  // --- REINSTATED ORIGINAL FUNCTION: Deletes the profile from plant_profiles ---
  const handleDeletePlant = () => {
    Modal.confirm({
      title: 'Delete Plant Profile?',
      icon: <ExclamationCircleOutlined />,
      content: `Are you sure you want to permanently delete the ${plant_name} (${stage}) profile? This action cannot be undone.`,
      okText: 'Yes, Delete',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          setDeleting(true);
          // NOTE: This relies on the separate /api/plants DELETE handler
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
        {/* NEW BUTTON: Selects the plant profile */}
        <Button 
          type="primary"
          size="large"
          loading={selecting}
          onClick={handleSelectPlant}
          style={{ marginRight: 8 }}
        >
          {selecting ? 'Starting...' : 'Select Plant'}
        </Button>
        {/* ORIGINAL BUTTON: Deletes the profile */}
        <Button 
          danger 
          size="large"
          loading={deleting}
          onClick={handleDeletePlant} // Using the original delete function
        >
          {deleting ? 'Deleting...' : 'Delete Profile'}
        </Button>
      </div>
    </div>
  );
}