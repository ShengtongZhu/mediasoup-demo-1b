import Logger from './Logger';

const logger = new Logger('QoELogger');

/**
 * QoE (Quality of Experience) Logger for video consumers
 * Tracks frame rate, bitrate, packet loss, frame delay, and other video quality metrics
 */
export default class QoELogger {
	constructor(consumerId, peerId, roomClient) {
		this.consumerId = consumerId;
		this.peerId = peerId;
		this.roomClient = roomClient;
		this.isLogging = false;
		this.logInterval = null;
		this.previousStats = null;
		this.qoeMetrics = {
			frameRate: 0,
			bitrate: 0,
			packetLoss: 0,
			frameDelay: 0,
			jitter: 0,
			resolution: { width: 0, height: 0 },
			codec: '',
			timestamp: Date.now()
		};

		// Store historical data for CSV export
		this.historicalData = [];

		// Bind methods
		this.start = this.start.bind(this);
		this.stop = this.stop.bind(this);
		this.collectMetrics = this.collectMetrics.bind(this);
	}

	/**
	 * Start QoE logging with specified interval
	 * @param {number} intervalMs - Logging interval in milliseconds (default: 2000ms)
	 */
	start(intervalMs = 2000) {
		if (this.isLogging) {
			logger.warn('QoE logging already started for consumer %s', this.consumerId);
			return;
		}

		this.isLogging = true;
		logger.debug('Starting QoE logging for consumer %s (peer: %s)', this.consumerId, this.peerId);

		// Collect initial metrics
		this.collectMetrics();

		// Set up periodic collection
		this.logInterval = setInterval(() => {
			this.collectMetrics();
		}, intervalMs);
	}

	/**
	 * Stop QoE logging
	 */
	stop() {
		if (!this.isLogging) {
			return;
		}

		this.isLogging = false;
		if (this.logInterval) {
			clearInterval(this.logInterval);
			this.logInterval = null;
		}

		logger.debug('Stopped QoE logging for consumer %s', this.consumerId);
	}

	/**
	 * Collect QoE metrics from both local and remote statistics
	 */
	async collectMetrics() {
		try {
			// Get both local and remote stats
			const [localStats, remoteStats] = await Promise.all([
				this.roomClient.getConsumerLocalStats(this.consumerId),
				this.roomClient.getConsumerRemoteStats(this.consumerId)
			]);

			if (!localStats && !remoteStats) {
				logger.warn('No stats available for consumer %s', this.consumerId);
				return;
			}

			const currentTime = Date.now();
			const timeDelta = this.previousStats ? 
				(currentTime - this.previousStats.timestamp) / 1000 : 1;

			// Process local stats (WebRTC stats)
			if (localStats) {
				this.processLocalStats(localStats, timeDelta);
			}

			// Process remote stats (mediasoup stats)
			if (remoteStats) {
				this.processRemoteStats(remoteStats, timeDelta);
			}

			// Update timestamp
			this.qoeMetrics.timestamp = currentTime;

			// Store a copy of current metrics in historical data
			this.historicalData.push({
				timestamp: this.qoeMetrics.timestamp,
				peerId: this.peerId,
				consumerId: this.consumerId,
				frameRate: this.qoeMetrics.frameRate,
				bitrate: Math.round(this.qoeMetrics.bitrate / 1000),
				packetLoss: this.qoeMetrics.packetLoss,
				jitter: this.qoeMetrics.jitter,
				frameDelay: this.qoeMetrics.frameDelay,
				resolution: `${this.qoeMetrics.resolution.width}x${this.qoeMetrics.resolution.height}`,
				codec: this.qoeMetrics.codec,
				score: this.qoeMetrics.score || 'N/A',
				fractionLost: this.qoeMetrics.fractionLost || 'N/A'
			});

			// Log the metrics
			this.logQoEMetrics();

			// Store current stats for next calculation
			this.previousStats = {
				local: localStats,
				remote: remoteStats,
				timestamp: currentTime
			};

		} catch (error) {
			logger.error('Error collecting QoE metrics for consumer %s: %o', this.consumerId, error);
		}
	}

	/**
	 * Process local WebRTC statistics
	 */
	processLocalStats(stats, timeDelta) {
		const statsArray = Array.from(stats.values());
		
		// Find inbound RTP stats for video
		const inboundRtp = statsArray.find(stat => 
			stat.type === 'inbound-rtp' && stat.kind === 'video'
		);

		if (inboundRtp) {
			// Calculate frame rate
			if (this.previousStats?.local) {
				const prevInbound = Array.from(this.previousStats.local.values())
					.find(stat => stat.type === 'inbound-rtp' && stat.kind === 'video');
				
				if (prevInbound) {
					const framesDelta = (inboundRtp.framesDecoded || 0) - (prevInbound.framesDecoded || 0);
					this.qoeMetrics.frameRate = Math.round(framesDelta / timeDelta);

					const bytesDelta = (inboundRtp.bytesReceived || 0) - (prevInbound.bytesReceived || 0);
					this.qoeMetrics.bitrate = Math.round((bytesDelta * 8) / timeDelta); // bits per second
				}
			}

			// Packet loss calculation
			const packetsLost = inboundRtp.packetsLost || 0;
			const packetsReceived = inboundRtp.packetsReceived || 0;
			const totalPackets = packetsLost + packetsReceived;
			this.qoeMetrics.packetLoss = totalPackets > 0 ? 
				Math.round((packetsLost / totalPackets) * 100 * 100) / 100 : 0; // percentage with 2 decimal places

			// Jitter
			this.qoeMetrics.jitter = Math.round((inboundRtp.jitter || 0) * 1000); // convert to ms

			// Resolution
			this.qoeMetrics.resolution = {
				width: inboundRtp.frameWidth || 0,
				height: inboundRtp.frameHeight || 0
			};

			// Frame delay (if available)
			if (inboundRtp.totalDecodeTime && inboundRtp.framesDecoded) {
				this.qoeMetrics.frameDelay = Math.round(
					(inboundRtp.totalDecodeTime / inboundRtp.framesDecoded) * 1000
				); // ms per frame
			}
		}

		// Find codec information
		const codec = statsArray.find(stat => stat.type === 'codec' && stat.mimeType);
		if (codec) {
			this.qoeMetrics.codec = codec.mimeType.split('/')[1] || '';
		}
	}

	/**
	 * Process remote mediasoup statistics
	 */
	processRemoteStats(stats, timeDelta) {
		if (Array.isArray(stats) && stats.length > 0) {
			const consumerStats = stats[0]; // Usually first entry contains consumer stats
			
			// Additional metrics from mediasoup
			if (consumerStats.score !== undefined) {
				this.qoeMetrics.score = consumerStats.score;
			}

			if (consumerStats.fractionLost !== undefined) {
				this.qoeMetrics.fractionLost = Math.round(consumerStats.fractionLost * 100 * 100) / 100;
			}
		}
	}

	/**
	 * Log QoE metrics in a structured format
	 */
	logQoEMetrics() {
		const metrics = this.qoeMetrics;
		const logData = {
			consumerId: this.consumerId,
			peerId: this.peerId,
			timestamp: new Date(metrics.timestamp).toISOString(),
			frameRate: `${metrics.frameRate} fps`,
			bitrate: `${Math.round(metrics.bitrate / 1000)} kbps`,
			packetLoss: `${metrics.packetLoss}%`,
			jitter: `${metrics.jitter} ms`,
			frameDelay: `${metrics.frameDelay} ms`,
			resolution: `${metrics.resolution.width}x${metrics.resolution.height}`,
			codec: metrics.codec
		};

		// Add mediasoup specific metrics if available
		if (metrics.score !== undefined) {
			logData.score = metrics.score;
		}
		if (metrics.fractionLost !== undefined) {
			logData.fractionLost = `${metrics.fractionLost}%`;
		}

		// Log to console in a readable format
		logger.debug('QoE Metrics [%s -> %s]: %o', this.peerId, this.consumerId, logData);

		// Also log as a single line for easy parsing
		const csvLine = [
			metrics.timestamp,
			this.peerId,
			this.consumerId,
			metrics.frameRate,
			Math.round(metrics.bitrate / 1000), // kbps
			metrics.packetLoss,
			metrics.jitter,
			metrics.frameDelay,
			`${metrics.resolution.width}x${metrics.resolution.height}`,
			metrics.codec,
			metrics.score || 'N/A',
			metrics.fractionLost || 'N/A'
		].join(',');

		console.log(`QoE_CSV: ${csvLine}`);
	}

	/**
	 * Get and clear accumulated historical data for CSV export
	 * @returns {Array} Array of historical data points
	 */
	getAndClearHistoricalData() {
		const data = [...this.historicalData];
		this.historicalData = []; // Clear after retrieval
		return data;
	}

	/**
	 * Get current QoE metrics
	 * @returns {Object} Current QoE metrics
	 */
	getCurrentMetrics() {
		return { ...this.qoeMetrics };
	}

	/**
	 * Get QoE summary for the session
	 * @returns {Object} QoE summary with averages and totals
	 */
	getSessionSummary() {
		// This could be extended to maintain historical data
		// For now, return current metrics
		return {
			peerId: this.peerId,
			consumerId: this.consumerId,
			currentMetrics: this.getCurrentMetrics(),
			sessionDuration: this.isLogging ? Date.now() - this.qoeMetrics.timestamp : 0
		};
	}
}