const Logger = require('./Logger');
const fs = require('fs').promises;
const path = require('path');

const logger = new Logger('QoECollector');

/**
 * Server-side QoE data collector with file writing capabilities
 * Collects additional metrics from mediasoup consumers
 */
class QoECollector {
	constructor() {
		this.consumerMetrics = new Map(); // consumerId -> metrics
		this.isEnabled = false;
		this.collectionInterval = null;
		this.csvWriteInterval = null;
		this.csvData = [];
		this.csvFilePath = null;
		this.sessionStartTime = null;
	}

	/**
	 * Enable QoE collection
	 * @param {number} intervalMs - Collection interval in milliseconds
	 * @param {number} csvWriteIntervalMs - CSV write interval in milliseconds
	 * @param {string} csvDirectory - Directory to save CSV files
	 */
	async enable(intervalMs = 5000, csvWriteIntervalMs = 30000, csvDirectory = './qoe-logs') {
		if (this.isEnabled) {
			logger.warn('QoE Collector already enabled');
			return;
		}

		this.isEnabled = true;
		this.sessionStartTime = new Date();
		this.csvData = [];
		this.csvFilePath = null;
		
		// Ensure CSV directory exists
		try {
			await fs.mkdir(csvDirectory, { recursive: true });
			
			// Create CSV file with timestamp
			const timestamp = this.sessionStartTime.toISOString().replace(/[:.]/g, '-');
			this.csvFilePath = path.join(csvDirectory, `server-qoe-${timestamp}.csv`);
			
			// Write CSV headers
			const headers = [
				'timestamp', 'peerId', 'consumerId', 'kind', 'type', 'ssrc',
				'score', 'producerScore', 'producerScores', 'preferredLayers',
				'currentLayers', 'bytesReceived', 'packetsReceived', 'packetsLost',
				'fractionLost', 'jitter', 'roundTripTime'
			];
			
			await fs.writeFile(this.csvFilePath, headers.join(',') + '\n');
			logger.debug('Created CSV file: %s', this.csvFilePath);
			
		} catch (error) {
			logger.error('Failed to create CSV directory or file: %o', error);
			this.csvFilePath = null;
		}

		logger.debug('QoE Collector enabled with %d ms interval, CSV write every %d ms', intervalMs, csvWriteIntervalMs);

		// Start periodic collection
		this.collectionInterval = setInterval(() => {
			this.collectAllMetrics();
		}, intervalMs);

		// Start periodic CSV writing
		if (this.csvFilePath) {
			this.csvWriteInterval = setInterval(() => {
				this.writeCSVData();
			}, csvWriteIntervalMs);
		}
	}

	/**
	 * Disable QoE collection
	 */
	async disable() {
		if (!this.isEnabled) {
			return;
		}

		this.isEnabled = false;
		
		if (this.collectionInterval) {
			clearInterval(this.collectionInterval);
			this.collectionInterval = null;
		}

		if (this.csvWriteInterval) {
			clearInterval(this.csvWriteInterval);
			this.csvWriteInterval = null;
		}

		// Write final CSV data
		await this.writeCSVData();

		logger.debug('QoE Collector disabled');
	}

	/**
	 * Write collected CSV data to file
	 */
	async writeCSVData() {
		if (!this.csvFilePath || this.csvData.length === 0) {
			return;
		}

		try {
			let csvContent = '';
			for (const row of this.csvData) {
				csvContent += row.join(',') + '\n';
			}

			await fs.appendFile(this.csvFilePath, csvContent);
			logger.debug('Wrote %d QoE records to CSV file', this.csvData.length);
			
			// Clear written data
			this.csvData = [];
			
		} catch (error) {
			logger.error('Failed to write CSV data: %o', error);
		}
	}

	/**
	 * Add a consumer for QoE tracking
	 * @param {Object} consumer - mediasoup Consumer
	 * @param {string} peerId - Peer ID
	 */
	addConsumer(consumer, peerId) {
		if (this.consumerMetrics.has(consumer.id)) {
			logger.warn('Consumer %s already being tracked', consumer.id);
			return;
		}

		const metrics = {
			consumerId: consumer.id,
			peerId: peerId,
			kind: consumer.kind,
			type: consumer.type,
			rtpParameters: consumer.rtpParameters,
			consumer: consumer,
			score: null,
			producerScore: null,
			producerScores: null,
			preferredLayers: null,
			currentLayers: null,
			lastStatsTime: Date.now(),
			stats: null
		};

		this.consumerMetrics.set(consumer.id, metrics);
		logger.debug('Added consumer %s (peer: %s, kind: %s) for QoE tracking', 
			consumer.id, peerId, consumer.kind);
	}

	/**
	 * Remove a consumer from QoE tracking
	 * @param {string} consumerId - Consumer ID
	 */
	removeConsumer(consumerId) {
		if (this.consumerMetrics.delete(consumerId)) {
			logger.debug('Removed consumer %s from QoE tracking', consumerId);
		}
	}

	/**
	 * Update consumer score
	 * @param {string} consumerId - Consumer ID
	 * @param {number} score - Consumer score
	 */
	updateConsumerScore(consumerId, score) {
		const metrics = this.consumerMetrics.get(consumerId);
		if (metrics) {
			metrics.score = score;
		}
	}

	/**
	 * Update consumer layers information
	 * @param {string} consumerId - Consumer ID
	 * @param {Object} layers - Layers information
	 */
	updateConsumerLayers(consumerId, layers) {
		const metrics = this.consumerMetrics.get(consumerId);
		if (metrics) {
			if (layers.preferredLayers !== undefined) {
				metrics.preferredLayers = layers.preferredLayers;
			}
			if (layers.currentLayers !== undefined) {
				metrics.currentLayers = layers.currentLayers;
			}
		}
	}

	/**
	 * Collect metrics for all consumers
	 */
	async collectAllMetrics() {
		if (!this.isEnabled) {
			return;
		}

		const promises = [];
		for (const [consumerId, metrics] of this.consumerMetrics) {
			promises.push(this.collectConsumerMetrics(consumerId, metrics));
		}

		await Promise.all(promises);
	}

	/**
	 * Collect metrics for a specific consumer
	 * @param {string} consumerId - Consumer ID
	 * @param {Object} metrics - Consumer metrics object
	 */
	async collectConsumerMetrics(consumerId, metrics) {
		try {
			const consumer = metrics.consumer;
			if (!consumer || consumer.closed) {
				return;
			}

			// Get consumer stats
			const stats = await consumer.getStats();
			metrics.stats = stats;
			metrics.lastStatsTime = Date.now();

			// Process stats and add to CSV data
			for (const stat of stats) {
				if (stat.type === 'inbound-rtp') {
					const csvRow = [
						Date.now(),
						metrics.peerId,
						consumerId,
						metrics.kind,
						stat.type,
						stat.ssrc || 'N/A',
						metrics.score || 'N/A',
						metrics.producerScore || 'N/A',
						metrics.producerScores ? JSON.stringify(metrics.producerScores) : 'N/A',
						metrics.preferredLayers ? JSON.stringify(metrics.preferredLayers) : 'N/A',
						metrics.currentLayers ? JSON.stringify(metrics.currentLayers) : 'N/A',
						stat.bytesReceived || 0,
						stat.packetsReceived || 0,
						stat.packetsLost || 0,
						stat.fractionLost || 0,
						stat.jitter || 0,
						stat.roundTripTime || 'N/A'
					];

					this.csvData.push(csvRow);
				}
			}

			// Log server QoE metrics
			this.logServerQoEMetrics({
				consumerId,
				peerId: metrics.peerId,
				kind: metrics.kind,
				score: metrics.score,
				stats: stats
			});

		} catch (error) {
			logger.error('Error collecting metrics for consumer %s: %o', consumerId, error);
		}
	}

	/**
	 * Log server-side QoE metrics
	 * @param {Object} qoeData - QoE data to log
	 */
	logServerQoEMetrics(qoeData) {
		const { consumerId, peerId, kind, score, stats } = qoeData;

		// Find inbound-rtp stats
		const inboundStats = stats.find(stat => stat.type === 'inbound-rtp');
		if (!inboundStats) {
			return;
		}

		const logData = {
			consumerId,
			peerId,
			kind,
			timestamp: new Date().toISOString(),
			score: score || 'N/A',
			bytesReceived: inboundStats.bytesReceived || 0,
			packetsReceived: inboundStats.packetsReceived || 0,
			packetsLost: inboundStats.packetsLost || 0,
			fractionLost: inboundStats.fractionLost ? 
				Math.round(inboundStats.fractionLost * 100 * 100) / 100 : 0,
			jitter: inboundStats.jitter || 0
		};

		logger.debug('Server QoE [%s -> %s]: %o', peerId, consumerId, logData);
	}

	/**
	 * Get metrics for a specific consumer
	 * @param {string} consumerId - Consumer ID
	 * @returns {Object|null} Consumer metrics or null if not found
	 */
	getConsumerMetrics(consumerId) {
		const metrics = this.consumerMetrics.get(consumerId);
		if (!metrics) {
			return null;
		}

		return {
			consumerId: metrics.consumerId,
			peerId: metrics.peerId,
			kind: metrics.kind,
			score: metrics.score,
			stats: metrics.stats,
			lastStatsTime: metrics.lastStatsTime
		};
	}

	/**
	 * Get all consumer metrics
	 * @returns {Array} Array of all consumer metrics
	 */
	getAllMetrics() {
		const allMetrics = [];
		for (const metrics of this.consumerMetrics.values()) {
			allMetrics.push(this.getConsumerMetrics(metrics.consumerId));
		}
		return allMetrics;
	}
}

module.exports = QoECollector;