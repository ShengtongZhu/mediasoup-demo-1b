import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { withRoomContext } from '../RoomContext';

const QoEDisplay = ({ roomClient, consumerId, peerId, onClose }) => {
	const [metrics, setMetrics] = useState(null);
	const [isVisible, setIsVisible] = useState(true);

	useEffect(() => {
		if (!roomClient || !consumerId) return;

		const updateMetrics = () => {
			const qoeMetrics = roomClient.getConsumerQoEMetrics(consumerId);
			setMetrics(qoeMetrics);
		};

		// Update immediately
		updateMetrics();

		// Update every 2 seconds
		const interval = setInterval(updateMetrics, 2000);

		return () => clearInterval(interval);
	}, [roomClient, consumerId]);

	const handleClose = () => {
		setIsVisible(false);
		if (onClose) onClose();
	};

	const handleExportCSV = () => {
		const csvData = roomClient.exportQoEAsCSV();
		const blob = new Blob([csvData], { type: 'text/csv' });
		const url = window.URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `qoe-metrics-${Date.now()}.csv`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		window.URL.revokeObjectURL(url);
	};

	if (!isVisible || !metrics) return null;

	return (
		<div className="qoe-display">
			<div className="qoe-header">
				<h3>QoE Metrics - {peerId}</h3>
				<div className="qoe-controls">
					<button onClick={handleExportCSV} className="export-btn">
						Export CSV
					</button>
					<button onClick={handleClose} className="close-btn">
						×
					</button>
				</div>
			</div>
			<div className="qoe-metrics">
				<div className="metric">
					<label>Frame Rate:</label>
					<span className={metrics.frameRate < 15 ? 'poor' : metrics.frameRate < 25 ? 'fair' : 'good'}>
						{metrics.frameRate} fps
					</span>
				</div>
				<div className="metric">
					<label>Bitrate:</label>
					<span className={metrics.bitrate < 500000 ? 'poor' : metrics.bitrate < 1000000 ? 'fair' : 'good'}>
						{Math.round(metrics.bitrate / 1000)} kbps
					</span>
				</div>
				<div className="metric">
					<label>Packet Loss:</label>
					<span className={metrics.packetLoss > 5 ? 'poor' : metrics.packetLoss > 2 ? 'fair' : 'good'}>
						{metrics.packetLoss}%
					</span>
				</div>
				<div className="metric">
					<label>Jitter:</label>
					<span className={metrics.jitter > 50 ? 'poor' : metrics.jitter > 20 ? 'fair' : 'good'}>
						{metrics.jitter} ms
					</span>
				</div>
				<div className="metric">
					<label>Frame Delay:</label>
					<span className={metrics.frameDelay > 100 ? 'poor' : metrics.frameDelay > 50 ? 'fair' : 'good'}>
						{metrics.frameDelay} ms
					</span>
				</div>
				<div className="metric">
					<label>Resolution:</label>
					<span>{metrics.resolution.width}×{metrics.resolution.height}</span>
				</div>
				<div className="metric">
					<label>Codec:</label>
					<span>{metrics.codec}</span>
				</div>
				{metrics.score !== undefined && (
					<div className="metric">
						<label>Score:</label>
						<span className={metrics.score < 5 ? 'poor' : metrics.score < 8 ? 'fair' : 'good'}>
							{metrics.score}/10
						</span>
					</div>
				)}
			</div>
			<div className="qoe-timestamp">
				Last updated: {new Date(metrics.timestamp).toLocaleTimeString()}
			</div>
		</div>
	);
};

QoEDisplay.propTypes = {
	roomClient: PropTypes.object.isRequired,
	consumerId: PropTypes.string.isRequired,
	peerId: PropTypes.string.isRequired,
	onClose: PropTypes.func
};

export default withRoomContext(QoEDisplay);