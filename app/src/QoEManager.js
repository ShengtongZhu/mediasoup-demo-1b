import Logger from './Logger';
import QoELogger from './QoELogger';

const logger = new Logger('QoEManager');

/**
 * QoE Manager - Manages QoE logging for all video consumers
 * Enhanced with localStorage-only CSV storage (no file downloads)
 */
export default class QoEManager {
	constructor(roomClient) {
		this.roomClient = roomClient;
		this.qoeLoggers = new Map(); // consumerId -> QoELogger
		this.isEnabled = false;
		this.logInterval = 2000; // Default 2 seconds
		this.csvSaveInterval = null;
		this.csvSaveIntervalMs = 10000; // Default 10 seconds for CSV saves
		this.csvData = []; // Store CSV rows for batch writing
		this.sessionStartTime = null;
		this.sessionFilename = null; // Single filename for the entire session

		// Bind methods
		this.enable = this.enable.bind(this);
		this.disable = this.disable.bind(this);
		this.addConsumer = this.addConsumer.bind(this);
		this.removeConsumer = this.removeConsumer.bind(this);
		this.saveCSVToLocalStorage = this.saveCSVToLocalStorage.bind(this);
		this.collectCSVData = this.collectCSVData.bind(this);
	}

	/**
	 * Enable QoE logging for all current and future consumers
	 * @param {number} intervalMs - Logging interval in milliseconds
	 * @param {number} csvSaveIntervalMs - CSV save interval in milliseconds
	 */
	enable(intervalMs = 2000, csvSaveIntervalMs = 10000) {
		if (this.isEnabled) {
			logger.warn('QoE Manager already enabled');
			return;
		}

		this.isEnabled = true;
		this.logInterval = intervalMs;
		this.csvSaveIntervalMs = csvSaveIntervalMs;
		this.sessionStartTime = new Date();
		this.csvData = [];
		
		// Create single session filename
		const timestamp = this.sessionStartTime.toISOString().replace(/[:.]/g, '-');
		this.sessionFilename = `qoe-session-${timestamp}.csv`;
		
		logger.debug('QoE Manager enabled with %d ms interval, CSV save every %d ms', intervalMs, csvSaveIntervalMs);
		logger.debug('Session CSV file: %s', this.sessionFilename);

		// Start logging for existing consumers
		for (const qoeLogger of this.qoeLoggers.values()) {
			qoeLogger.start(intervalMs);
		}

		// Start periodic CSV data collection and storage
		this.csvSaveInterval = setInterval(() => {
			this.collectCSVData();
			this.saveCSVToLocalStorage();
		}, csvSaveIntervalMs);

		// Save initial headers to the session file
		this.saveCSVToLocalStorage(true);

		// Print CSV headers to console for reference
		const headers = [
			'timestamp', 'peerId', 'consumerId', 'frameRate(fps)', 
			'bitrate(kbps)', 'packetLoss(%)', 'jitter(ms)', 'frameDelay(ms)', 
			'resolution', 'codec', 'score', 'fractionLost(%)'
		];
		logger.debug('CSV Headers: %s', headers.join(','));
	}

	/**
	 * Disable QoE logging
	 */
	disable() {
		if (!this.isEnabled) {
			logger.warn('QoE Manager already disabled');
			return;
		}

		this.isEnabled = false;

		// Stop all QoE loggers
		for (const qoeLogger of this.qoeLoggers.values()) {
			qoeLogger.stop();
		}

		// Stop CSV collection interval
		if (this.csvSaveInterval) {
			clearInterval(this.csvSaveInterval);
			this.csvSaveInterval = null;
		}

		// Save any remaining data
		if (this.csvData.length > 0) {
			this.saveCSVToLocalStorage();
		}

		logger.debug('QoE Manager disabled');
	}

	/**
	 * Add a consumer for QoE logging
	 * @param {string} consumerId - Consumer ID
	 * @param {string} peerId - Peer ID
	 * @param {string} kind - Media kind ('video' or 'audio')
	 */
	addConsumer(consumerId, peerId, kind = 'video') {
		// Only track video consumers for QoE
		if (kind !== 'video') {
			return;
		}

		if (this.qoeLoggers.has(consumerId)) {
			logger.warn('Consumer %s already being tracked', consumerId);
			return;
		}

		const qoeLogger = new QoELogger(consumerId, peerId, this.roomClient);
		this.qoeLoggers.set(consumerId, qoeLogger);

		// Start logging if QoE Manager is enabled
		if (this.isEnabled) {
			qoeLogger.start(this.logInterval);
		}

		logger.debug('Added QoE logging for consumer %s (peer: %s)', consumerId, peerId);
	}

	/**
	 * Remove a consumer from QoE logging
	 * @param {string} consumerId - Consumer ID
	 */
	removeConsumer(consumerId) {
		const qoeLogger = this.qoeLoggers.get(consumerId);
		if (qoeLogger) {
			qoeLogger.stop();
			this.qoeLoggers.delete(consumerId);
			logger.debug('Removed QoE logging for consumer %s', consumerId);
		}
	}

	/**
	 * Collect current CSV data from all loggers
	 */
	collectCSVData() {
		const currentTime = Date.now();
		
		for (const [consumerId, qoeLogger] of this.qoeLoggers) {
			const metrics = qoeLogger.getCurrentMetrics();
			
			// Only collect if we have valid metrics
			if (metrics.timestamp && metrics.timestamp > 0) {
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
				
				this.csvData.push(row);
			}
		}
	}

	/**
	 * Save CSV data to localStorage only (no file download)
	 * @param {boolean} headersOnly - If true, only save headers
	 */
	saveCSVToLocalStorage(headersOnly = false) {
		try {
			const headers = [
				'timestamp', 'peerId', 'consumerId', 'frameRate(fps)', 
				'bitrate(kbps)', 'packetLoss(%)', 'jitter(ms)', 'frameDelay(ms)', 
				'resolution', 'codec', 'score', 'fractionLost(%)'
			];

			// Get existing content from the session file
			let existingContent = localStorage.getItem(`qoe-csv-${this.sessionFilename}`) || '';
			
			// If file doesn't exist or is empty, add headers
			if (!existingContent || headersOnly) {
				existingContent = headers.join(',') + '\n';
			}

			// Add new data rows if not headers-only
			if (!headersOnly && this.csvData.length > 0) {
				for (const row of this.csvData) {
					existingContent += row.join(',') + '\n';
				}
				
				// Clear the data after saving
				this.csvData = [];
			}

			// Store updated content back to localStorage
			this.storeCSVInLocalStorage(existingContent, this.sessionFilename);

			if (!headersOnly) {
				logger.debug('CSV data appended to session file: %s (%d bytes)', this.sessionFilename, existingContent.length);
			}

		} catch (error) {
			logger.error('Error saving CSV to localStorage: %o', error);
		}
	}

	/**
	 * Store CSV data in localStorage
	 * @param {string} csvContent - CSV content
	 * @param {string} filename - Filename
	 */
	storeCSVInLocalStorage(csvContent, filename) {
		try {
			// Store current file
			localStorage.setItem(`qoe-csv-${filename}`, csvContent);
			
			// Maintain a list of all CSV files
			const existingFiles = JSON.parse(localStorage.getItem('qoe-csv-files') || '[]');
			if (!existingFiles.includes(filename)) {
				existingFiles.push(filename);
				
				// Keep only last 10 session files to avoid storage overflow
				if (existingFiles.length > 10) {
					const oldFile = existingFiles.shift();
					localStorage.removeItem(`qoe-csv-${oldFile}`);
				}
				
				localStorage.setItem('qoe-csv-files', JSON.stringify(existingFiles));
			}
		} catch (error) {
			logger.error('Error storing CSV in localStorage: %o', error);
		}
	}

	/**
	 * Get all stored CSV files from localStorage
	 * @returns {Array} Array of {filename, content, size, timestamp} objects
	 */
	getStoredCSVFiles() {
		try {
			const files = JSON.parse(localStorage.getItem('qoe-csv-files') || '[]');
			return files.map(filename => {
				const content = localStorage.getItem(`qoe-csv-${filename}`) || '';
				return {
					filename,
					content,
					size: content.length,
					timestamp: filename.match(/qoe-metrics-(.+)\.csv/)?.[1] || 'unknown'
				};
			}).sort((a, b) => b.timestamp.localeCompare(a.timestamp)); // Sort by timestamp, newest first
		} catch (error) {
			logger.error('Error retrieving stored CSV files: %o', error);
			return [];
		}
	}

	/**
	 * Get a specific CSV file content
	 * @param {string} filename - Filename to retrieve
	 * @returns {string|null} CSV content or null if not found
	 */
	getCSVFile(filename) {
		try {
			return localStorage.getItem(`qoe-csv-${filename}`);
		} catch (error) {
			logger.error('Error retrieving CSV file %s: %o', filename, error);
			return null;
		}
	}

	/**
	 * Clear all stored CSV files
	 */
	clearStoredCSVFiles() {
		try {
			const files = JSON.parse(localStorage.getItem('qoe-csv-files') || '[]');
			files.forEach(filename => {
				localStorage.removeItem(`qoe-csv-${filename}`);
			});
			localStorage.removeItem('qoe-csv-files');
			logger.debug('Cleared all stored CSV files');
		} catch (error) {
			logger.error('Error clearing stored CSV files: %o', error);
		}
	}

	/**
	 * Get storage usage statistics
	 * @returns {Object} Storage statistics
	 */
	getStorageStats() {
		try {
			const files = this.getStoredCSVFiles();
			const totalSize = files.reduce((sum, file) => sum + file.size, 0);
			const totalFiles = files.length;
			
			return {
				totalFiles,
				totalSize,
				totalSizeKB: Math.round(totalSize / 1024),
				files: files.map(f => ({
					filename: f.filename,
					size: f.size,
					sizeKB: Math.round(f.size / 1024),
					timestamp: f.timestamp
				}))
			};
		} catch (error) {
			logger.error('Error getting storage stats: %o', error);
			return { totalFiles: 0, totalSize: 0, totalSizeKB: 0, files: [] };
		}
	}

	/**
	 * Set CSV save interval
	 * @param {number} intervalMs - New interval in milliseconds
	 */
	setCSVSaveInterval(intervalMs) {
		if (intervalMs < 1000) {
			logger.warn('CSV save interval too short, minimum is 1000ms');
			return;
		}

		this.csvSaveIntervalMs = intervalMs;
		
		if (this.isEnabled && this.csvSaveInterval) {
			clearInterval(this.csvSaveInterval);
			this.csvSaveInterval = setInterval(() => {
				this.collectCSVData();
				this.saveCSVToLocalStorage();
			}, intervalMs);
			
			logger.debug('CSV save interval updated to %d ms', intervalMs);
		}
	}

	/**
	 * Manually trigger CSV save
	 */
	manualSaveCSV() {
		if (this.isEnabled) {
			this.collectCSVData();
			this.saveCSVToLocalStorage();
			logger.debug('Manual CSV save triggered');
		} else {
			logger.warn('QoE Manager not enabled, cannot save CSV');
		}
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
	 * Export QoE data as CSV (current snapshot)
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