const Logger = require('./Logger');

const logger = new Logger('QoECollector');

/**
 * Server-side QoE data collector
 * Collects additional metrics from mediasoup consumers
 */
class QoECollector {
	constructor() {
		this.consumerMetrics = new Map(); // consumerId -> metrics
		this.isEnabled = false;
		this.collectionInterval = null;
	}

	/**
	 * Enable QoE collection
	 * @param {number} intervalMs - Collection interval in milliseconds
	 */
	enable(intervalMs = 5000) {
		if (this.isEnabled) {
			logger.warn('QoE Collector already enabled');
			return;
		}

		this.isEnabled = true;
		logger.debug('QoE Collector enabled with %d ms interval', intervalMs);

		this.collectionInterval = setInterval(() => {
			this.collectAllMetrics();
		}, intervalMs);
	}

	/**
	 * Disable QoE collection
	 */
	disable() {
		if (!this.isEnabled) {
			return;
		}

		this.isEnabled = false;
		if (this.collectionInterval) {
			clearInterval(this.collectionInterval);
			this.collectionInterval = null;
		}

		logger.debug('QoE Collector disabled');
	}

	/**
	 * Add a consumer for QoE monitoring
	 * @param {Object} consumer - mediasoup Consumer
	 * @param {string} peerId - Peer ID
	 */
	addConsumer(consumer, peerId) {
		if (consumer.kind !== 'video') {
			return; // Only monitor video consumers
		}

		logger.debug('Adding consumer %s (peer: %s) for QoE monitoring', consumer.id, peerId);

		this.consumerMetrics.set(consumer.id, {
			consumer,
			peerId,
			lastStats: null,
			history: []
		});

		// Set up consumer events for additional metrics
		consumer.on('score', (score) => {
			this.updateConsumerScore(consumer.id, score);
		});

		consumer.on('layerschange', (layers) => {
			this.updateConsumerLayers(consumer.id, layers);
		});
	}

	/**
	 * Remove a consumer from QoE monitoring
	 * @param {string} consumerId - Consumer ID
	 */
	removeConsumer(consumerId) {
		if (this.consumerMetrics.has(consumerId)) {
			logger.debug('Removing consumer %s from QoE monitoring', consumerId);
			this.consumerMetrics.delete(consumerId);
		}
	}

	/**
	 * Update consumer score
	 * @param {string} consumerId - Consumer ID
	 * @param {Array} score - Score array
	 */
	updateConsumerScore(consumerId, score) {
		const metrics = this.consumerMetrics.get(consumerId);
		if (metrics) {
			metrics.lastScore = score;
			metrics.lastScoreTime = Date.now();
		}
	}

	/**
	 * Update consumer layers
	 * @param {string} consumerId - Consumer ID
	 * @param {Object} layers - Layers object
	 */
	updateConsumerLayers(consumerId, layers) {
		const metrics = this.consumerMetrics.get(consumerId);
		if (metrics) {
			metrics.lastLayers = layers;
			metrics.lastLayersTime = Date.now();
		}
	}

	/**
	 * Collect metrics for all consumers
	 */
	async collectAllMetrics() {
		for (const [consumerId, metrics] of this.consumerMetrics) {
			try {
				await this.collectConsumerMetrics(consumerId, metrics);
			} catch (error) {
				logger.error('Error collecting metrics for consumer %s: %o', consumerId, error);
			}
		}
	}

	/**
	 * Collect metrics for a specific consumer
	 * @param {string} consumerId - Consumer ID
	 * @param {Object} metrics - Metrics object
	 */
	async collectConsumerMetrics(consumerId, metrics) {
		const { consumer, peerId } = metrics;

		try {
			const stats = await consumer.getStats();
			const timestamp = Date.now();

			const qoeData = {
				timestamp,
				consumerId,
				peerId,
				stats,
				score: metrics.lastScore,
				layers: metrics.lastLayers
			};

			// Store in history (keep last 100 entries)
			metrics.history.push(qoeData);
			if (metrics.history.length > 100) {
				metrics.history.shift();
			}

			// Log server-side QoE data
			this.logServerQoEMetrics(qoeData);

			metrics.lastStats = stats;

		} catch (error) {
			logger.error('Failed to get stats for consumer %s: %o', consumerId, error);
		}
	}

	/**
	 * Log server-side QoE metrics
	 * @param {Object} qoeData - QoE data
	 */
	logServerQoEMetrics(qoeData) {
		const { timestamp, consumerId, peerId, stats, score, layers } = qoeData;

		if (stats && stats.length > 0) {
			const consumerStats = stats[0];
			
			const logData = {
				timestamp: new Date(timestamp).toISOString(),
				consumerId,
				peerId,
				bytesReceived: consumerStats.bytesReceived || 0,
				packetsReceived: consumerStats.packetsReceived || 0,
				packetsLost: consumerStats.packetsLost || 0,
				fractionLost: consumerStats.fractionLost || 0,
				jitter: consumerStats.jitter || 0,
				score: score ? score.map(s => s.score).join(',') : 'N/A',
				spatialLayer: layers?.spatialLayer ?? 'N/A',
				temporalLayer: layers?.temporalLayer ?? 'N/A'
			};

			logger.debug('Server QoE Metrics [%s -> %s]: %o', peerId, consumerId, logData);

			// CSV format for server-side logging
			const csvLine = [
				timestamp,
				peerId,
				consumerId,
				consumerStats.bytesReceived || 0,
				consumerStats.packetsReceived || 0,
				consumerStats.packetsLost || 0,
				Math.round((consumerStats.fractionLost || 0) * 100 * 100) / 100,
				Math.round((consumerStats.jitter || 0) * 1000),
				score ? score.map(s => s.score).join(',') : 'N/A',
				layers?.spatialLayer ?? 'N/A',
				layers?.temporalLayer ?? 'N/A'
			].join(',');

			console.log(`SERVER_QoE_CSV: ${csvLine}`);
		}
	}

	/**
	 * Get QoE metrics for a consumer
	 * @param {string} consumerId - Consumer ID
	 * @returns {Object|null} QoE metrics or null
	 */
	getConsumerMetrics(consumerId) {
		const metrics = this.consumerMetrics.get(consumerId);
		return metrics ? {
			consumerId,
			peerId: metrics.peerId,
			lastStats: metrics.lastStats,
			lastScore: metrics.lastScore,
			lastLayers: metrics.lastLayers,
			historyCount: metrics.history.length
		} : null;
	}

	/**
	 * Get all QoE metrics
	 * @returns {Object} All QoE metrics
	 */
	getAllMetrics() {
		const allMetrics = {};
		for (const [consumerId, metrics] of this.consumerMetrics) {
			allMetrics[consumerId] = this.getConsumerMetrics(consumerId);
		}
		return allMetrics;
	}
}

module.exports = QoECollector;