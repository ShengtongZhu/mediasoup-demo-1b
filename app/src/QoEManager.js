import Logger from './Logger';
import QoELogger from './QoELogger';

const logger = new Logger('QoEManager');

/**
 * QoE Manager - Manages QoE logging for all video consumers
 */
export default class QoEManager {
	constructor(roomClient) {
		this.roomClient = roomClient;
		this.qoeLoggers = new Map(); // consumerId -> QoELogger
		this.isEnabled = false;
		this.logInterval = 2000; // Default 2 seconds

		// Bind methods
		this.enable = this.enable.bind(this);
		this.disable = this.disable.bind(this);
		this.addConsumer = this.addConsumer.bind(this);
		this.removeConsumer = this.removeConsumer.bind(this);
	}

	/**
	 * Enable QoE logging for all current and future consumers
	 * @param {number} intervalMs - Logging interval in milliseconds
	 */
	enable(intervalMs = 2000) {
		if (this.isEnabled) {
			logger.warn('QoE Manager already enabled');
			return;
		}

		this.isEnabled = true;
		this.logInterval = intervalMs;
		logger.debug('QoE Manager enabled with %d ms interval', intervalMs);

		// Start logging for existing consumers
		for (const qoeLogger of this.qoeLoggers.values()) {
			qoeLogger.start(intervalMs);
		}

		// Log CSV header for easy parsing
		console.log('QoE_CSV_HEADER: timestamp,peerId,consumerId,frameRate(fps),bitrate(kbps),packetLoss(%),jitter(ms),frameDelay(ms),resolution,codec,score,fractionLost(%)');
	}

	/**
	 * Disable QoE logging for all consumers
	 */
	disable() {
		if (!this.isEnabled) {
			return;
		}

		this.isEnabled = false;
		logger.debug('QoE Manager disabled');

		// Stop all loggers
		for (const qoeLogger of this.qoeLoggers.values()) {
			qoeLogger.stop();
		}
	}

	/**
	 * Add a consumer for QoE logging
	 * @param {string} consumerId - Consumer ID
	 * @param {string} peerId - Peer ID
	 * @param {string} kind - Media kind ('video' or 'audio')
	 */
	addConsumer(consumerId, peerId, kind = 'video') {
		// Only log video consumers for QoE
		if (kind !== 'video') {
			return;
		}

		if (this.qoeLoggers.has(consumerId)) {
			logger.warn('Consumer %s already being logged', consumerId);
			return;
		}

		logger.debug('Adding consumer %s (peer: %s) for QoE logging', consumerId, peerId);

		const qoeLogger = new QoELogger(consumerId, peerId, this.roomClient);
		this.qoeLoggers.set(consumerId, qoeLogger);

		// Start logging if manager is enabled
		if (this.isEnabled) {
			qoeLogger.start(this.logInterval);
		}
	}

	/**
	 * Remove a consumer from QoE logging
	 * @param {string} consumerId - Consumer ID
	 */
	removeConsumer(consumerId) {
		const qoeLogger = this.qoeLoggers.get(consumerId);
		if (!qoeLogger) {
			return;
		}

		logger.debug('Removing consumer %s from QoE logging', consumerId);

		qoeLogger.stop();
		this.qoeLoggers.delete(consumerId);
	}

	/**
	 * Get QoE metrics for all consumers
	 * @returns {Object} QoE metrics for all consumers
	 */
	getAllMetrics() {
		const metrics = {};
		for (const [consumerId, qoeLogger] of this.qoeLoggers) {
			metrics[consumerId] = qoeLogger.getCurrentMetrics();
		}
		return metrics;
	}

	/**
	 * Get QoE metrics for a specific consumer
	 * @param {string} consumerId - Consumer ID
	 * @returns {Object|null} QoE metrics or null if not found
	 */
	getConsumerMetrics(consumerId) {
		const qoeLogger = this.qoeLoggers.get(consumerId);
		return qoeLogger ? qoeLogger.getCurrentMetrics() : null;
	}

	/**
	 * Get session summary for all consumers
	 * @returns {Array} Array of session summaries
	 */
	getSessionSummary() {
		const summaries = [];
		for (const qoeLogger of this.qoeLoggers.values()) {
			summaries.push(qoeLogger.getSessionSummary());
		}
		return summaries;
	}

	/**
	 * Export QoE data as CSV
	 * @returns {string} CSV formatted QoE data
	 */
	exportAsCSV() {
		const headers = [
			'timestamp', 'peerId', 'consumerId', 'frameRate(fps)', 
			'bitrate(kbps)', 'packetLoss(%)', 'jitter(ms)', 'frameDelay(ms)', 
			'resolution', 'codec', 'score', 'fractionLost(%)'
		];

		let csv = headers.join(',') + '\n';

		for (const [consumerId, qoeLogger] of this.qoeLoggers) {
			const metrics = qoeLogger.getCurrentMetrics();
			const row = [
				metrics.timestamp,
				qoeLogger.peerId,
				consumerId,
				metrics.frameRate,
				Math.round(metrics.bitrate / 1000),
				metrics.packetLoss,
				metrics.jitter,
				metrics.frameDelay,
				`${metrics.resolution.width}x${metrics.resolution.height}`,
				metrics.codec,
				metrics.score || 'N/A',
				metrics.fractionLost || 'N/A'
			];
			csv += row.join(',') + '\n';
		}

		return csv;
	}
}