import protooClient from 'protoo-client';
import * as mediasoupClient from 'mediasoup-client';
import Logger from './Logger';
import { getProtooUrl } from './urlFactory';
import * as cookiesManager from './cookiesManager';
import * as requestActions from './redux/requestActions';
import * as stateActions from './redux/stateActions';
import * as e2e from './e2e';
import QoEManager from './QoEManager';

const VIDEO_CONSTRAINS = {
	qvga: { width: { ideal: 320 }, height: { ideal: 240 } },
	vga: { width: { ideal: 640 }, height: { ideal: 480 } },
	hd: { width: { ideal: 1280 }, height: { ideal: 720 } },
	fhd: { width: { ideal: 1920 }, height: { ideal: 1080 } },
};

const PC_PROPRIETARY_CONSTRAINTS = {
	// optional : [ { googDscp: true } ]
};

const DEFAULT_VIDEOS = [
	'/videos/lab1.mp4',
	// Add more video files as needed
];

const getExternalVideoSrc = (videoSource) => {
	if (videoSource && videoSource !== 'true') {
		// If a specific video path is provided
		return videoSource.startsWith('/') ? videoSource : `/videos/${videoSource}`;
	}
	// Return default video
	return DEFAULT_VIDEOS[0];
};

const logger = new Logger('RoomClient');

let store;

export default class RoomClient {
	/**
	 * @param  {Object} data
	 * @param  {Object} data.store - The Redux store.
	 */
	static init(data) {
		store = data.store;
	}

	constructor({
		roomId,
		peerId,
		displayName,
		device,
		handlerName,
		forceTcp,
		produce,
		consume,
		mic,
		webcam,
		datachannel,
		enableWebcamLayers,
		enableSharingLayers,
		webcamScalabilityMode,
		sharingScalabilityMode,
		numSimulcastStreams,
		preferLocalCodecsOrder,
		forcePCMA,
		forceVP8,
		forceH264,
		forceVP9,
		forceAV1,
		externalVideo,
		videoSource,
		e2eKey,
		consumerReplicas,
		stats,
	}) {
		logger.debug(
			'constructor() [roomId:"%s", peerId:"%s", displayName:"%s", device:%s]',
			roomId,
			peerId,
			displayName,
			device.flag
		);

		// Closed flag.
		// @type {Boolean}
		this._closed = false;

		// Display name.
		// @type {String}
		this._displayName = displayName;

		// Device info.
		// @type {Object}
		this._device = device;

		// Custom mediasoup-client handler name (to override default browser
		// detection if desired).
		// @type {String}
		this._handlerName = handlerName;

		// Whether we want to force RTC over TCP.
		// @type {Boolean}
		this._forceTcp = forceTcp;

		// Whether we want to produce audio/video.
		// @type {Boolean}
		this._produce = produce;

		// Whether we should consume.
		// @type {Boolean}
		this._consume = consume;

		// Whether we should enable mic by default.
		// @type {Boolean}
		this._useMic = Boolean(mic);

		// Whether we should enable webcam by default.
		// @type {Boolean | undefined}
		this._useWebcam = webcam;

		// Whether we want DataChannels.
		// @type {Boolean}
		this._useDataChannel = Boolean(datachannel);

		// Prefer the codecs order of the browser instead of the codecs order
		// configured in the server.
		// @type {Boolean}
		this._preferLocalCodecsOrder = Boolean(preferLocalCodecsOrder);

		// Force PCMA codec for sending.
		// @type {Boolean}
		this._forcePCMA = Boolean(forcePCMA);

		// Force VP8 codec for sending.
		// @type {Boolean}
		this._forceVP8 = Boolean(forceVP8);

		// Force H264 codec for sending.
		// @type {Boolean}
		this._forceH264 = Boolean(forceH264);

		// Force VP9 codec for sending.
		// @type {Boolean}
		this._forceVP9 = Boolean(forceVP9);

		// Force AV1 codec for sending.
		// @type {Boolean}
		this._forceAV1 = Boolean(forceAV1);

		// Whether simulcast or SVC should be used for webcam.
		// @type {Boolean}
		this._enableWebcamLayers = Boolean(enableWebcamLayers);

		// Whether simulcast or SVC should be used in desktop sharing.
		// @type {Boolean}
		this._enableSharingLayers = Boolean(enableSharingLayers);

		// Scalability mode for webcam.
		// @type {String}
		this._webcamScalabilityMode = webcamScalabilityMode;

		// Scalability mode for sharing.
		// @type {String}
		this._sharingScalabilityMode = sharingScalabilityMode;

		// Number of simuclast streams for webcam and sharing.
		// @type {Number}
		this._numSimulcastStreams = numSimulcastStreams;

		// External video.
		// @type {HTMLVideoElement}
		this._externalVideo = null;

		// Store video source configuration
		this._videoSource = videoSource;
		this._currentVideoSrc = null;

		// Enabled end-to-end encryption.
		this._e2eKey = e2eKey;

		// Show WebRTC stats.
		this._stats = stats;

		// MediaStream of the external video.
		// @type {MediaStream}
		this._externalVideoStream = null;

		// Next expected dataChannel test number.
		// @type {Number}
		this._nextDataChannelTestNumber = 0;

		if (externalVideo) {
			this._externalVideo = document.createElement('video');

			this._externalVideo.controls = true;
			this._externalVideo.muted = true;
			this._externalVideo.loop = true;
			this._externalVideo.setAttribute('playsinline', '');
			
			// Use dynamic video source instead of static EXTERNAL_VIDEO_SRC
			this._currentVideoSrc = getExternalVideoSrc(videoSource);
			this._externalVideo.src = this._currentVideoSrc;

			this._externalVideo
				.play()
				.catch(error => logger.warn('externalVideo.play() failed:%o', error));
		}

		// Protoo URL.
		// @type {String}
		this._protooUrl = getProtooUrl({ roomId, peerId, consumerReplicas });

		// protoo-client Peer instance.
		// @type {protooClient.Peer}
		this._protoo = null;

		// mediasoup-client Device instance.
		// @type {mediasoupClient.Device}
		this._mediasoupDevice = null;

		// mediasoup Transport for sending.
		// @type {mediasoupClient.Transport}
		this._sendTransport = null;

		// mediasoup Transport for receiving.
		// @type {mediasoupClient.Transport}
		this._recvTransport = null;

		// Local mic mediasoup Producer.
		// @type {mediasoupClient.Producer}
		this._micProducer = null;

		// Local webcam mediasoup Producer.
		// @type {mediasoupClient.Producer}
		this._webcamProducer = null;

		// Local share mediasoup Producer.
		// @type {mediasoupClient.Producer}
		this._shareProducer = null;

		// Local chat DataProducer.
		// @type {mediasoupClient.DataProducer}
		this._chatDataProducer = null;

		// Local bot DataProducer.
		// @type {mediasoupClient.DataProducer}
		this._botDataProducer = null;

		// mediasoup Consumers.
		// @type {Map<String, mediasoupClient.Consumer>}
		this._consumers = new Map();

		// mediasoup DataConsumers.
		// @type {Map<String, mediasoupClient.DataConsumer>}
		this._dataConsumers = new Map();

		// Map of webcam MediaDeviceInfos indexed by deviceId.
		// @type {Map<String, MediaDeviceInfos>}
		this._webcams = new Map();

		// Local Webcam.
		// @type {Object} with:
		// - {MediaDeviceInfo} [device]
		// - {String} [resolution] - 'qvga' / 'vga' / 'hd'.
		this._webcam = {
			device: null,
			resolution: 'fhd',
		};

		if (this._e2eKey && e2e.isSupported()) {
			e2e.setCryptoKey('setCryptoKey', this._e2eKey, true);
		}

		// QoE Manager for video quality logging
		this._qoeManager = new QoEManager(this);
	}

	close() {
		if (this._closed) return;

		this._closed = true;

		logger.debug('close()');

		// Disable QoE logging
		this._qoeManager.disable();

		// Close protoo Peer
		this._protoo.close();

		// Close mediasoup Transports.
		if (this._sendTransport) {
			this._sendTransport.close();
			this._sendTransport = null;
		}

		if (this._recvTransport) {
			this._recvTransport.close();
			this._recvTransport = null;
		}

		store.dispatch(stateActions.setRoomState('closed'));
	}

	async join() {
		store.dispatch(
			stateActions.setMediasoupClientVersion(mediasoupClient.version)
		);

		const protooTransport = new protooClient.WebSocketTransport(
			this._protooUrl
		);

		this._protoo = new protooClient.Peer(protooTransport);

		store.dispatch(stateActions.setRoomState('connecting'));

		this._protoo.on('open', () => this._joinRoom());

		this._protoo.on('failed', () => {
			store.dispatch(
				requestActions.notify({
					type: 'error',
					text: 'WebSocket connection failed',
				})
			);
		});

		this._protoo.on('disconnected', () => {
			store.dispatch(
				requestActions.notify({
					type: 'error',
					text: 'WebSocket disconnected',
				})
			);

			// Close mediasoup Transports.
			if (this._sendTransport) {
				this._sendTransport.close();
				this._sendTransport = null;
			}

			if (this._recvTransport) {
				this._recvTransport.close();
				this._recvTransport = null;
			}

			store.dispatch(stateActions.setRoomState('closed'));
		});

		this._protoo.on('close', () => {
			if (this._closed) return;

			this.close();
		});

		// eslint-disable-next-line no-unused-vars
		this._protoo.on('request', async (request, accept, reject) => {
			logger.debug(
				'proto "request" event [method:%s, data:%o]',
				request.method,
				request.data
			);

			switch (request.method) {
				case 'newConsumer': {
					if (!this._consume) {
						reject(403, 'I do not want to consume');

						break;
					}

					const {
						peerId,
						producerId,
						id,
						kind,
						rtpParameters,
						type,
						appData,
						producerPaused,
					} = request.data;

					try {
						const consumer = await this._recvTransport.consume({
							id,
							producerId,
							kind,
							rtpParameters,
							// NOTE: Force streamId to be same in mic and webcam and different
							// in screen sharing so libwebrtc will just try to sync mic and
							// webcam streams from the same remote peer.
							streamId: `${peerId}-${appData.share ? 'share' : 'mic-webcam'}`,
							appData: { ...appData, peerId }, // Trick.
						});

						if (this._e2eKey && e2e.isSupported()) {
							e2e.setupReceiverTransform(consumer.rtpReceiver);
						}

						// Store in the map.
						this._consumers.set(consumer.id, consumer);

						consumer.on('transportclose', () => {
							this._consumers.delete(consumer.id);
						});

						consumer.on('producerclose', () => {
							logger.debug('Consumer "producerclose" event [consumerId:%s]', consumer.id);

							this._consumers.delete(consumer.id);

							store.dispatch(stateActions.removeConsumer(consumer.id, peerId));
						});

						consumer.on('producerpause', () => {
							logger.debug('Consumer "producerpause" event [consumerId:%s]', consumer.id);

							store.dispatch(stateActions.setConsumerPaused(consumer.id, 'remote'));
						});

						consumer.on('producerresume', () => {
							logger.debug('Consumer "producerresume" event [consumerId:%s]', consumer.id);

							store.dispatch(stateActions.setConsumerResumed(consumer.id, 'remote'));
						});

						consumer.on('score', (score) => {
							logger.debug('Consumer "score" event [consumerId:%s, score:%o]', consumer.id, score);

							store.dispatch(stateActions.setConsumerScore(consumer.id, score));
						});

						consumer.on('layerschange', (layers) => {
							logger.debug(
								'Consumer "layerschange" event [consumerId:%s, layers:%o]',
								consumer.id,
								layers
							);

							store.dispatch(stateActions.setConsumerLayers(consumer.id, layers));
						});

						const { spatialLayers, temporalLayers } =
							mediasoupClient.parseScalabilityMode(
								consumer.rtpParameters.encodings[0].scalabilityMode
							);

						store.dispatch(
							stateActions.addConsumer(
								{
									id: consumer.id,
									type: type,
									locallyPaused: false,
									remotelyPaused: producerPaused,
									rtpParameters: consumer.rtpParameters,
									spatialLayers: spatialLayers,
									temporalLayers: temporalLayers,
									preferredSpatialLayer: spatialLayers - 1,
									preferredTemporalLayer: temporalLayers - 1,
									priority: 1,
									codec:
										consumer.rtpParameters.codecs[0].mimeType.split('/')[1],
									track: consumer.track,
								},
								peerId
							)
						);

						// Add consumer to QoE logging
						this._qoeManager.addConsumer(consumer.id, peerId, consumer.kind);

						// We are ready. Answer the protoo request so the server will
						// resume this Consumer (which was paused for now if video).
						accept();

						// FIXED: Only pause video consumers if explicitly in audio-only mode
						// and not when using external video (pre-recorded video broadcasting)
						if (consumer.kind === 'video' && 
							store.getState().me.audioOnly && 
							!this._externalVideo) {
							this._pauseConsumer(consumer);
						}
						
						// For external video broadcasting, ensure video consumers stay active
						if (consumer.kind === 'video' && this._externalVideo) {
							// Force resume the consumer to ensure it stays active
							setTimeout(() => {
								if (!consumer.closed && consumer.paused) {
									this._resumeConsumer(consumer);
								}
							}, 100);
						}
					} catch (error) {
						logger.error('"newConsumer" request failed:%o', error);

						store.dispatch(
							requestActions.notify({
								type: 'error',
								text: `Error creating a Consumer: ${error}`,
							})
						);

						throw error;
					}

					break;
				}

				case 'newDataConsumer': {
					if (!this._consume) {
						reject(403, 'I do not want to data consume');

						break;
					}

					if (!this._useDataChannel) {
						reject(403, 'I do not want DataChannels');

						break;
					}

					const {
						peerId, // NOTE: Null if bot.
						dataProducerId,
						id,
						sctpStreamParameters,
						label,
						protocol,
						appData,
					} = request.data;

					try {
						const dataConsumer = await this._recvTransport.consumeData({
							id,
							dataProducerId,
							sctpStreamParameters,
							label,
							protocol,
							appData: { ...appData, peerId }, // Trick.
						});

						// Store in the map.
						this._dataConsumers.set(dataConsumer.id, dataConsumer);

						dataConsumer.on('transportclose', () => {
							this._dataConsumers.delete(dataConsumer.id);
						});

						dataConsumer.on('open', () => {
							logger.debug('DataConsumer "open" event');
						});

						dataConsumer.on('close', () => {
							logger.warn('DataConsumer "close" event');

							this._dataConsumers.delete(dataConsumer.id);

							store.dispatch(
								requestActions.notify({
									type: 'error',
									text: 'DataConsumer closed',
								})
							);
						});

						dataConsumer.on('error', error => {
							logger.error('DataConsumer "error" event:%o', error);

							store.dispatch(
								requestActions.notify({
									type: 'error',
									text: `DataConsumer error: ${error}`,
								})
							);
						});

						dataConsumer.on('message', message => {
							logger.debug(
								'DataConsumer "message" event [streamId:%d]',
								dataConsumer.sctpStreamParameters.streamId
							);

							// TODO: For debugging.
							window.DC_MESSAGE = message;

							if (message instanceof ArrayBuffer) {
								const view = new DataView(message);
								const number = view.getUint32();

								if (number == Math.pow(2, 32) - 1) {
									logger.warn('dataChannelTest finished!');

									this._nextDataChannelTestNumber = 0;

									return;
								}

								if (number > this._nextDataChannelTestNumber) {
									logger.warn(
										'dataChannelTest: %s packets missing',
										number - this._nextDataChannelTestNumber
									);
								}

								this._nextDataChannelTestNumber = number + 1;

								return;
							} else if (typeof message !== 'string') {
								logger.warn('ignoring DataConsumer "message" (not a string)');

								return;
							}

							switch (dataConsumer.label) {
								case 'chat': {
									const { peers } = store.getState();
									const peersArray = Object.keys(peers).map(
										_peerId => peers[_peerId]
									);
									const sendingPeer = peersArray.find(peer =>
										peer.dataConsumers.includes(dataConsumer.id)
									);

									if (!sendingPeer) {
										logger.warn('DataConsumer "message" from unknown peer');

										break;
									}

									store.dispatch(
										requestActions.notify({
											title: `${sendingPeer.displayName} says:`,
											text: message,
											timeout: 5000,
										})
									);

									break;
								}

								case 'bot': {
									store.dispatch(
										requestActions.notify({
											title: 'Message from Bot:',
											text: message,
											timeout: 5000,
										})
									);

									break;
								}
							}
						});

						// TODO: REMOVE
						window.DC = dataConsumer;

						store.dispatch(
							stateActions.addDataConsumer(
								{
									id: dataConsumer.id,
									sctpStreamParameters: dataConsumer.sctpStreamParameters,
									label: dataConsumer.label,
									protocol: dataConsumer.protocol,
								},
								peerId
							)
						);

						// We are ready. Answer the protoo request.
						accept();
					} catch (error) {
						logger.error('"newDataConsumer" request failed:%o', error);

						store.dispatch(
							requestActions.notify({
								type: 'error',
								text: `Error creating a DataConsumer: ${error}`,
							})
						);

						throw error;
					}

					break;
				}
			}
		});

		this._protoo.on('notification', notification => {
			logger.debug(
				'proto "notification" event [method:%s, data:%o]',
				notification.method,
				notification.data
			);

			switch (notification.method) {
				case 'mediasoup-version': {
					const { version } = notification.data;

					store.dispatch(stateActions.setMediasoupVersion(version));

					break;
				}

				case 'producerScore': {
					const { producerId, score } = notification.data;

					store.dispatch(stateActions.setProducerScore(producerId, score));

					break;
				}

				case 'newPeer': {
					const peer = notification.data;

					store.dispatch(
						stateActions.addPeer({ ...peer, consumers: [], dataConsumers: [] })
					);

					store.dispatch(
						requestActions.notify({
							text: `${peer.displayName} has joined the room`,
						})
					);

					break;
				}

				case 'peerClosed': {
					const { peerId } = notification.data;

					store.dispatch(stateActions.removePeer(peerId));

					break;
				}

				case 'peerDisplayNameChanged': {
					const { peerId, displayName, oldDisplayName } = notification.data;

					store.dispatch(stateActions.setPeerDisplayName(displayName, peerId));

					store.dispatch(
						requestActions.notify({
							text: `${oldDisplayName} is now ${displayName}`,
						})
					);

					break;
				}

				case 'downlinkBwe': {
					logger.debug("'downlinkBwe' event:%o", notification.data);

					break;
				}

				case 'consumerClosed': {
					const { consumerId } = notification.data;
					const consumer = this._consumers.get(consumerId);

					if (!consumer) break;

					// Remove from QoE logging
					this._qoeManager.removeConsumer(consumerId);

					consumer.close();
					this._consumers.delete(consumerId);

					const { peerId } = consumer.appData;

					store.dispatch(stateActions.removeConsumer(consumerId, peerId));

					break;
				}

				case 'consumerPaused': {
					const { consumerId } = notification.data;
					const consumer = this._consumers.get(consumerId);

					if (!consumer) break;

					consumer.pause();

					store.dispatch(stateActions.setConsumerPaused(consumerId, 'remote'));

					break;
				}

				case 'consumerResumed': {
					const { consumerId } = notification.data;
					const consumer = this._consumers.get(consumerId);

					if (!consumer) break;

					consumer.resume();

					store.dispatch(stateActions.setConsumerResumed(consumerId, 'remote'));

					break;
				}

				case 'consumerLayersChanged': {
					const { consumerId, spatialLayer, temporalLayer } = notification.data;
					const consumer = this._consumers.get(consumerId);

					if (!consumer) break;

					store.dispatch(
						stateActions.setConsumerCurrentLayers(
							consumerId,
							spatialLayer,
							temporalLayer
						)
					);

					break;
				}

				case 'consumerScore': {
					const { consumerId, score } = notification.data;

					store.dispatch(stateActions.setConsumerScore(consumerId, score));

					break;
				}

				case 'dataConsumerClosed': {
					const { dataConsumerId } = notification.data;
					const dataConsumer = this._dataConsumers.get(dataConsumerId);

					if (!dataConsumer) break;

					dataConsumer.close();
					this._dataConsumers.delete(dataConsumerId);

					const { peerId } = dataConsumer.appData;

					store.dispatch(
						stateActions.removeDataConsumer(dataConsumerId, peerId)
					);

					break;
				}

				case 'activeSpeaker': {
					const { peerId } = notification.data;

					store.dispatch(stateActions.setRoomActiveSpeaker(peerId));

					break;
				}

				default: {
					logger.error(
						'unknown protoo notification.method "%s"',
						notification.method
					);
				}
			}
		});
	}

	async enableMic() {
		logger.debug('enableMic()');

		if (this._micProducer) return;

		if (!this._mediasoupDevice.canProduce('audio')) {
			logger.error('enableMic() | cannot produce audio');

			return;
		}

		let track;

		try {
			if (!this._externalVideo) {
				logger.debug('enableMic() | calling getUserMedia()');

				const stream = await navigator.mediaDevices.getUserMedia({
					audio: true,
				});

				track = stream.getAudioTracks()[0];
			} else {
				const stream = await this._getExternalVideoStream();

				// Use the original audio track to avoid freezes with captureStream clones
				track = stream.getAudioTracks()[0];
			}

			let codec;
			let codecOptions = {
				opusStereo: true,
				opusDtx: true,
				opusFec: true,
				opusNack: true,
			};

			if (this._forcePCMA) {
				codec = this._mediasoupDevice.rtpCapabilities.codecs.find(
					c => c.mimeType.toLowerCase() === 'audio/pcma'
				);

				if (!codec) {
					throw new Error('desired PCMA codec+configuration is not supported');
				}

				codecOptions = undefined;
			}

			this._micProducer = await this._sendTransport.produce({
				track,
				codecOptions: {
					opusStereo: true,
					opusDtx: true,
					opusFec: true,
					opusNack: true,
				},
				codec,
			});

			if (this._e2eKey && e2e.isSupported()) {
				e2e.setupSenderTransform(this._micProducer.rtpSender);
			}

			store.dispatch(
				stateActions.addProducer({
					id: this._micProducer.id,
					paused: this._micProducer.paused,
					track: this._micProducer.track,
					rtpParameters: this._micProducer.rtpParameters,
					codec:
						this._micProducer.rtpParameters.codecs[0].mimeType.split('/')[1],
				})
			);

			this._micProducer.on('transportclose', () => {
				this._micProducer = null;
			});

			this._micProducer.on('trackended', () => {
				store.dispatch(
					requestActions.notify({
						type: 'error',
						text: 'Microphone disconnected!',
					})
				);

				this.disableMic().catch(() => {});
			});
		} catch (error) {
			logger.error('enableMic() | failed:%o', error);

			store.dispatch(
				requestActions.notify({
					type: 'error',
					text: `Error enabling microphone: ${error}`,
				})
			);

			if (track) track.stop();
		}
	}

	async disableMic() {
		logger.debug('disableMic()');

		if (!this._micProducer) return;

		this._micProducer.close();

		store.dispatch(stateActions.removeProducer(this._micProducer.id));

		try {
			await this._protoo.request('closeProducer', {
				producerId: this._micProducer.id,
			});
		} catch (error) {
			store.dispatch(
				requestActions.notify({
					type: 'error',
					text: `Error closing server-side mic Producer: ${error}`,
				})
			);
		}

		this._micProducer = null;
	}

	async muteMic() {
		logger.debug('muteMic()');

		this._micProducer.pause();

		try {
			await this._protoo.request('pauseProducer', {
				producerId: this._micProducer.id,
			});

			store.dispatch(stateActions.setProducerPaused(this._micProducer.id));
		} catch (error) {
			logger.error('muteMic() | failed: %o', error);

			store.dispatch(
				requestActions.notify({
					type: 'error',
					text: `Error pausing server-side mic Producer: ${error}`,
				})
			);
		}
	}

	async unmuteMic() {
		logger.debug('unmuteMic()');

		this._micProducer.resume();

		try {
			await this._protoo.request('resumeProducer', {
				producerId: this._micProducer.id,
			});

			store.dispatch(stateActions.setProducerResumed(this._micProducer.id));
		} catch (error) {
			logger.error('unmuteMic() | failed: %o', error);

			store.dispatch(
				requestActions.notify({
					type: 'error',
					text: `Error resuming server-side mic Producer: ${error}`,
				})
			);
		}
	}

	async enableWebcam() {
		logger.debug('enableWebcam()');

		if (this._webcamProducer) return;
		else if (this._shareProducer) await this.disableShare();

		if (!this._mediasoupDevice.canProduce('video')) {
			logger.error('enableWebcam() | cannot produce video');

			return;
		}

		let track;
		let device;

		store.dispatch(stateActions.setWebcamInProgress(true));

		try {
			if (!this._externalVideo) {
				await this._updateWebcams();
				device = this._webcam.device;

				const { resolution } = this._webcam;

				if (!device) throw new Error('no webcam devices');

				logger.debug('enableWebcam() | calling getUserMedia()');

				const stream = await navigator.mediaDevices.getUserMedia({
					video: {
						deviceId: { ideal: device.deviceId },
						...VIDEO_CONSTRAINS[resolution],
					},
				});

				track = stream.getVideoTracks()[0];
			} else {
				device = { label: 'external video' };

				const stream = await this._getExternalVideoStream();

				// Use the original video track to avoid freezes with captureStream clones
				track = stream.getVideoTracks()[0];
			}

			let encodings;
			let codec;
			const codecOptions = {
				videoGoogleStartBitrate: 1000,
			};

			if (this._forceVP8) {
				codec = this._mediasoupDevice.rtpCapabilities.codecs.find(
					c => c.mimeType.toLowerCase() === 'video/vp8'
				);

				if (!codec) {
					throw new Error('desired VP8 codec+configuration is not supported');
				}
			} else if (this._forceH264) {
				codec = this._mediasoupDevice.rtpCapabilities.codecs.find(
					c => c.mimeType.toLowerCase() === 'video/h264'
				);

				if (!codec) {
					throw new Error('desired H264 codec+configuration is not supported');
				}
			} else if (this._forceVP9) {
				codec = this._mediasoupDevice.rtpCapabilities.codecs.find(
					c => c.mimeType.toLowerCase() === 'video/vp9'
				);

				if (!codec) {
					throw new Error('desired VP9 codec+configuration is not supported');
				}
			} else if (this._forceAV1) {
				codec = this._mediasoupDevice.rtpCapabilities.codecs.find(
					c => c.mimeType.toLowerCase() === 'video/av1'
				);

				if (!codec) {
					throw new Error('desired AV1 codec+configuration is not supported');
				}
			}

			if (this._enableWebcamLayers) {
				// If VP9 is the only available video codec then use SVC.
				const firstVideoCodec =
					this._mediasoupDevice.rtpCapabilities.codecs.find(
						c => c.kind === 'video'
					);

				// VP9 or AV1 with SVC.
				if (
					((this._forceVP9 || this._forceAV1) && codec) ||
					['video/vp9', 'video/av1'].includes(
						firstVideoCodec.mimeType.toLowerCase()
					)
				) {
					encodings = [
						{
							maxBitrate: 5000000,
							scalabilityMode: this._webcamScalabilityMode || 'L1T3',
						},
					];
				}
				// VP8 or H264 with simulcast.
				else {
					encodings = [
						{
							scaleResolutionDownBy: 1,
							maxBitrate: 5000000,
							scalabilityMode: this._webcamScalabilityMode || 'L1T3',
						},
					];

					if (this._numSimulcastStreams > 1) {
						encodings.unshift({
							scaleResolutionDownBy: 2,
							maxBitrate: 1000000,
							scalabilityMode: this._webcamScalabilityMode || 'L1T3',
						});
					}

					if (this._numSimulcastStreams > 2) {
						encodings.unshift({
							scaleResolutionDownBy: 4,
							maxBitrate: 500000,
							scalabilityMode: this._webcamScalabilityMode || 'L1T3',
						});
					}
				}
			}

			this._webcamProducer = await this._sendTransport.produce({
				track,
				encodings,
				codecOptions,
				codec,
			});

			if (this._e2eKey && e2e.isSupported()) {
				e2e.setupSenderTransform(this._webcamProducer.rtpSender);
			}

			store.dispatch(
				stateActions.addProducer({
					id: this._webcamProducer.id,
					deviceLabel: device.label,
					type: this._getWebcamType(device),
					paused: this._webcamProducer.paused,
					track: this._webcamProducer.track,
					rtpParameters: this._webcamProducer.rtpParameters,
					codec:
						this._webcamProducer.rtpParameters.codecs[0].mimeType.split('/')[1],
				})
			);

			this._webcamProducer.on('transportclose', () => {
				this._webcamProducer = null;
			});

			this._webcamProducer.on('trackended', () => {
				store.dispatch(
					requestActions.notify({
						type: 'error',
						text: 'Webcam disconnected!',
					})
				);

				this.disableWebcam().catch(() => {});
			});
		} catch (error) {
			logger.error('enableWebcam() | failed:%o', error);

			store.dispatch(
				requestActions.notify({
					type: 'error',
					text: `Error enabling webcam: ${error}`,
				})
			);

			if (track) track.stop();
		}

		store.dispatch(stateActions.setWebcamInProgress(false));
	}

	async disableWebcam() {
		logger.debug('disableWebcam()');

		if (!this._webcamProducer) return;

		this._webcamProducer.close();

		store.dispatch(stateActions.removeProducer(this._webcamProducer.id));

		try {
			await this._protoo.request('closeProducer', {
				producerId: this._webcamProducer.id,
			});
		} catch (error) {
			store.dispatch(
				requestActions.notify({
					type: 'error',
					text: `Error closing server-side webcam Producer: ${error}`,
				})
			);
		}

		this._webcamProducer = null;
	}

	async changeWebcam() {
		logger.debug('changeWebcam()');

		store.dispatch(stateActions.setWebcamInProgress(true));

		try {
			await this._updateWebcams();

			const array = Array.from(this._webcams.keys());
			const len = array.length;
			const deviceId = this._webcam.device
				? this._webcam.device.deviceId
				: undefined;
			let idx = array.indexOf(deviceId);

			if (idx < len - 1) idx++;
			else idx = 0;

			this._webcam.device = this._webcams.get(array[idx]);

			logger.debug(
				'changeWebcam() | new selected webcam [device:%o]',
				this._webcam.device
			);

			// Reset video resolution to HD.
			this._webcam.resolution = 'fhd';

			if (!this._webcam.device) throw new Error('no webcam devices');

			// Closing the current video track before asking for a new one (mobiles do not like
			// having both front/back cameras open at the same time).
			this._webcamProducer.track.stop();

			logger.debug('changeWebcam() | calling getUserMedia()');

			const stream = await navigator.mediaDevices.getUserMedia({
				video: {
					deviceId: { exact: this._webcam.device.deviceId },
					...VIDEO_CONSTRAINS[this._webcam.resolution],
				},
			});

			const track = stream.getVideoTracks()[0];

			await this._webcamProducer.replaceTrack({ track });

			store.dispatch(
				stateActions.setProducerTrack(this._webcamProducer.id, track)
			);
		} catch (error) {
			logger.error('changeWebcam() | failed: %o', error);

			store.dispatch(
				requestActions.notify({
					type: 'error',
					text: `Could not change webcam: ${error}`,
				})
			);
		}

		store.dispatch(stateActions.setWebcamInProgress(false));
	}

	async changeWebcamResolution() {
		logger.debug('changeWebcamResolution()');

		store.dispatch(stateActions.setWebcamInProgress(true));

		try {
			switch (this._webcam.resolution) {
				case 'qvga':
					this._webcam.resolution = 'vga';
					break;
				case 'vga':
					this._webcam.resolution = 'hd';
					break;
				case 'hd':
					this._webcam.resolution = 'fhd';
					break;
				case 'fhd':
					this._webcam.resolution = 'qvga';
					break;
				default:
					this._webcam.resolution = 'fhd';
			}

			logger.debug('changeWebcamResolution() | calling getUserMedia()');

			const stream = await navigator.mediaDevices.getUserMedia({
				video: {
					deviceId: { exact: this._webcam.device.deviceId },
					...VIDEO_CONSTRAINS[this._webcam.resolution],
				},
			});

			const track = stream.getVideoTracks()[0];

			await this._webcamProducer.replaceTrack({ track });

			store.dispatch(
				stateActions.setProducerTrack(this._webcamProducer.id, track)
			);
		} catch (error) {
			logger.error('changeWebcamResolution() | failed: %o', error);

			store.dispatch(
				requestActions.notify({
					type: 'error',
					text: `Could not change webcam resolution: ${error}`,
				})
			);
		}

		store.dispatch(stateActions.setWebcamInProgress(false));
	}

	async enableShare() {
		logger.debug('enableShare()');

		if (this._shareProducer) return;
		else if (this._webcamProducer) await this.disableWebcam();

		if (!this._mediasoupDevice.canProduce('video')) {
			logger.error('enableShare() | cannot produce video');

			return;
		}

		let track;

		store.dispatch(stateActions.setShareInProgress(true));

		try {
			logger.debug('enableShare() | calling getUserMedia()');

			const stream = await navigator.mediaDevices.getDisplayMedia({
				audio: false,
				video: {
					displaySurface: 'monitor',
					logicalSurface: true,
					cursor: true,
					width: { max: 1920 },
					height: { max: 1080 },
					frameRate: { max: 30 },
				},
			});

			// May mean cancelled (in some implementations).
			if (!stream) {
				store.dispatch(stateActions.setShareInProgress(true));

				return;
			}

			track = stream.getVideoTracks()[0];

			let encodings;
			let codec;
			const codecOptions = {
				videoGoogleStartBitrate: 1000,
			};

			if (this._forceVP8) {
				codec = this._mediasoupDevice.rtpCapabilities.codecs.find(
					c => c.mimeType.toLowerCase() === 'video/vp8'
				);

				if (!codec) {
					throw new Error('desired VP8 codec+configuration is not supported');
				}
			} else if (this._forceH264) {
				codec = this._mediasoupDevice.rtpCapabilities.codecs.find(
					c => c.mimeType.toLowerCase() === 'video/h264'
				);

				if (!codec) {
					throw new Error('desired H264 codec+configuration is not supported');
				}
			} else if (this._forceVP9) {
				codec = this._mediasoupDevice.rtpCapabilities.codecs.find(
					c => c.mimeType.toLowerCase() === 'video/vp9'
				);

				if (!codec) {
					throw new Error('desired VP9 codec+configuration is not supported');
				}
			} else if (this._forceAV1) {
				codec = this._mediasoupDevice.rtpCapabilities.codecs.find(
					c => c.mimeType.toLowerCase() === 'video/av1'
				);

				if (!codec) {
					throw new Error('desired AV1 codec+configuration is not supported');
				}
			}

			if (this._enableSharingLayers) {
				// If VP9 is the only available video codec then use SVC.
				const firstVideoCodec =
					this._mediasoupDevice.rtpCapabilities.codecs.find(
						c => c.kind === 'video'
					);

				// VP9 or AV1 with SVC.
				if (
					((this._forceVP9 || this._forceAV1) && codec) ||
					['video/vp9', 'video/av1'].includes(
						firstVideoCodec.mimeType.toLowerCase()
					)
				) {
					encodings = [
						{
							maxBitrate: 5000000,
							scalabilityMode: this._sharingScalabilityMode || 'L3T3',
							dtx: true,
						},
					];
				}
				// VP8 or H264 with simulcast.
				else {
					encodings = [
						{
							scaleResolutionDownBy: 1,
							maxBitrate: 5000000,
							scalabilityMode: this._sharingScalabilityMode || 'L1T3',
							dtx: true,
						},
					];

					if (this._numSimulcastStreams > 1) {
						encodings.unshift({
							scaleResolutionDownBy: 2,
							maxBitrate: 1000000,
							scalabilityMode: this._sharingScalabilityMode || 'L1T3',
							dtx: true,
						});
					}

					if (this._numSimulcastStreams > 2) {
						encodings.unshift({
							scaleResolutionDownBy: 4,
							maxBitrate: 500000,
							scalabilityMode: this._sharingScalabilityMode || 'L1T3',
							dtx: true,
						});
					}
				}
			}

			this._shareProducer = await this._sendTransport.produce({
				track,
				encodings,
				codecOptions,
				codec,
				appData: {
					share: true,
				},
			});

			if (this._e2eKey && e2e.isSupported()) {
				e2e.setupSenderTransform(this._shareProducer.rtpSender);
			}

			store.dispatch(
				stateActions.addProducer({
					id: this._shareProducer.id,
					type: 'share',
					paused: this._shareProducer.paused,
					track: this._shareProducer.track,
					rtpParameters: this._shareProducer.rtpParameters,
					codec:
						this._shareProducer.rtpParameters.codecs[0].mimeType.split('/')[1],
				})
			);

			this._shareProducer.on('transportclose', () => {
				this._shareProducer = null;
			});

			this._shareProducer.on('trackended', () => {
				store.dispatch(
					requestActions.notify({
						type: 'error',
						text: 'Share disconnected!',
					})
				);

				this.disableShare().catch(() => {});
			});
		} catch (error) {
			logger.error('enableShare() | failed:%o', error);

			if (error.name !== 'NotAllowedError') {
				store.dispatch(
					requestActions.notify({
						type: 'error',
						text: `Error sharing: ${error}`,
					})
				);
			}

			if (track) track.stop();
		}

		store.dispatch(stateActions.setShareInProgress(false));
	}

	async disableShare() {
		logger.debug('disableShare()');

		if (!this._shareProducer) return;

		this._shareProducer.close();

		store.dispatch(stateActions.removeProducer(this._shareProducer.id));

		try {
			await this._protoo.request('closeProducer', {
				producerId: this._shareProducer.id,
			});
		} catch (error) {
			store.dispatch(
				requestActions.notify({
					type: 'error',
					text: `Error closing server-side share Producer: ${error}`,
				})
			);
		}

		this._shareProducer = null;
	}

	async enableAudioOnly() {
		logger.debug('enableAudioOnly()');

		// Prevent audio-only mode when using external video for broadcasting
		if (this._externalVideo && this._produce) {
			logger.warn('Audio-only mode disabled during external video broadcasting');
			return;
		}

		store.dispatch(stateActions.setAudioOnlyInProgress(true));

		this.disableWebcam();

		for (const consumer of this._consumers.values()) {
			if (consumer.kind !== 'video') continue;

			this._pauseConsumer(consumer);
		}

		store.dispatch(stateActions.setAudioOnlyState(true));

		store.dispatch(stateActions.setAudioOnlyInProgress(false));
	}

	async disableAudioOnly() {
		logger.debug('disableAudioOnly()');

		store.dispatch(stateActions.setAudioOnlyInProgress(true));

		if (
			!this._webcamProducer &&
			this._produce &&
			(cookiesManager.getDevices() || {}).webcamEnabled
		) {
			this.enableWebcam();
		}

		for (const consumer of this._consumers.values()) {
			if (consumer.kind !== 'video') continue;

			this._resumeConsumer(consumer);
		}

		store.dispatch(stateActions.setAudioOnlyState(false));

		store.dispatch(stateActions.setAudioOnlyInProgress(false));
	}

	async muteAudio() {
		logger.debug('muteAudio()');

		store.dispatch(stateActions.setAudioMutedState(true));
	}

	async unmuteAudio() {
		logger.debug('unmuteAudio()');

		store.dispatch(stateActions.setAudioMutedState(false));
	}

	async restartIce() {
		logger.debug('restartIce()');

		store.dispatch(stateActions.setRestartIceInProgress(true));

		try {
			if (this._sendTransport) {
				const iceParameters = await this._protoo.request('restartIce', {
					transportId: this._sendTransport.id,
				});

				await this._sendTransport.restartIce({ iceParameters });
			}

			if (this._recvTransport) {
				const iceParameters = await this._protoo.request('restartIce', {
					transportId: this._recvTransport.id,
				});

				await this._recvTransport.restartIce({ iceParameters });
			}

			store.dispatch(
				requestActions.notify({
					text: 'ICE restarted',
				})
			);
		} catch (error) {
			logger.error('restartIce() | failed:%o', error);

			store.dispatch(
				requestActions.notify({
					type: 'error',
					text: `ICE restart failed: ${error}`,
				})
			);
		}

		store.dispatch(stateActions.setRestartIceInProgress(false));
	}

	async setMaxSendingSpatialLayer(spatialLayer) {
		logger.debug('setMaxSendingSpatialLayer() [spatialLayer:%s]', spatialLayer);

		try {
			if (this._webcamProducer)
				await this._webcamProducer.setMaxSpatialLayer(spatialLayer);
			else if (this._shareProducer)
				await this._shareProducer.setMaxSpatialLayer(spatialLayer);
		} catch (error) {
			logger.error('setMaxSendingSpatialLayer() | failed:%o', error);

			store.dispatch(
				requestActions.notify({
					type: 'error',
					text: `Error setting max sending video spatial layer: ${error}`,
				})
			);
		}
	}

	async setConsumerPreferredLayers(consumerId, spatialLayer, temporalLayer) {
		logger.debug(
			'setConsumerPreferredLayers() [consumerId:%s, spatialLayer:%s, temporalLayer:%s]',
			consumerId,
			spatialLayer,
			temporalLayer
		);

		try {
			await this._protoo.request('setConsumerPreferredLayers', {
				consumerId,
				spatialLayer,
				temporalLayer,
			});

			store.dispatch(
				stateActions.setConsumerPreferredLayers(
					consumerId,
					spatialLayer,
					temporalLayer
				)
			);
		} catch (error) {
			logger.error('setConsumerPreferredLayers() | failed:%o', error);

			store.dispatch(
				requestActions.notify({
					type: 'error',
					text: `Error setting Consumer preferred layers: ${error}`,
				})
			);
		}
	}

	async setConsumerPriority(consumerId, priority) {
		logger.debug(
			'setConsumerPriority() [consumerId:%s, priority:%d]',
			consumerId,
			priority
		);

		try {
			await this._protoo.request('setConsumerPriority', {
				consumerId,
				priority,
			});

			store.dispatch(stateActions.setConsumerPriority(consumerId, priority));
		} catch (error) {
			logger.error('setConsumerPriority() | failed:%o', error);

			store.dispatch(
				requestActions.notify({
					type: 'error',
					text: `Error setting Consumer priority: ${error}`,
				})
			);
		}
	}

	async requestConsumerKeyFrame(consumerId) {
		logger.debug('requestConsumerKeyFrame() [consumerId:%s]', consumerId);

		try {
			await this._protoo.request('requestConsumerKeyFrame', { consumerId });

			store.dispatch(
				requestActions.notify({
					text: 'Keyframe requested for video consumer',
				})
			);
		} catch (error) {
			logger.error('requestConsumerKeyFrame() | failed:%o', error);

			store.dispatch(
				requestActions.notify({
					type: 'error',
					text: `Error requesting key frame for Consumer: ${error}`,
				})
			);
		}
	}

	async enableChatDataProducer() {
		logger.debug('enableChatDataProducer()');

		// NOTE: Should enable this code but it's useful for testing.
		// if (this._chatDataProducer)
		// 	return;

		try {
			// Create chat DataProducer.
			this._chatDataProducer = await this._sendTransport.produceData({
				// ordered: false,
				// maxRetransmits: 1,
				ordered: true,
				label: 'chat',
				priority: 'medium',
				appData: { info: 'my-chat-DataProducer' },
			});

			store.dispatch(
				stateActions.addDataProducer({
					id: this._chatDataProducer.id,
					sctpStreamParameters: this._chatDataProducer.sctpStreamParameters,
					label: this._chatDataProducer.label,
					protocol: this._chatDataProducer.protocol,
				})
			);

			this._chatDataProducer.on('transportclose', () => {
				this._chatDataProducer = null;
			});

			this._chatDataProducer.on('open', () => {
				logger.debug('chat DataProducer "open" event');
			});

			this._chatDataProducer.on('close', () => {
				logger.error('chat DataProducer "close" event');

				this._chatDataProducer = null;

				store.dispatch(
					requestActions.notify({
						type: 'error',
						text: 'Chat DataProducer closed',
					})
				);
			});

			this._chatDataProducer.on('error', error => {
				logger.error('chat DataProducer "error" event:%o', error);

				store.dispatch(
					requestActions.notify({
						type: 'error',
						text: `Chat DataProducer error: ${error}`,
					})
				);
			});

			this._chatDataProducer.on('bufferedamountlow', () => {
				logger.debug('chat DataProducer "bufferedamountlow" event');
			});
		} catch (error) {
			logger.error('enableChatDataProducer() | failed:%o', error);

			store.dispatch(
				requestActions.notify({
					type: 'error',
					text: `Error enabling chat DataProducer: ${error}`,
				})
			);

			throw error;
		}
	}

	async enableBotDataProducer() {
		logger.debug('enableBotDataProducer()');

		// NOTE: Should enable this code but it's useful for testing.
		// if (this._botDataProducer)
		// 	return;

		try {
			// Create chat DataProducer.
			this._botDataProducer = await this._sendTransport.produceData({
				// ordered: false,
				// maxPacketLifeTime: 2000,
				ordered: true,
				label: 'bot',
				priority: 'medium',
				appData: { info: 'my-bot-DataProducer' },
			});

			store.dispatch(
				stateActions.addDataProducer({
					id: this._botDataProducer.id,
					sctpStreamParameters: this._botDataProducer.sctpStreamParameters,
					label: this._botDataProducer.label,
					protocol: this._botDataProducer.protocol,
				})
			);

			this._botDataProducer.on('transportclose', () => {
				this._botDataProducer = null;
			});

			this._botDataProducer.on('open', () => {
				logger.debug('bot DataProducer "open" event');
			});

			this._botDataProducer.on('close', () => {
				logger.error('bot DataProducer "close" event');

				this._botDataProducer = null;

				store.dispatch(
					requestActions.notify({
						type: 'error',
						text: 'Bot DataProducer closed',
					})
				);
			});

			this._botDataProducer.on('error', error => {
				logger.error('bot DataProducer "error" event:%o', error);

				store.dispatch(
					requestActions.notify({
						type: 'error',
						text: `Bot DataProducer error: ${error}`,
					})
				);
			});

			this._botDataProducer.on('bufferedamountlow', () => {
				logger.debug('bot DataProducer "bufferedamountlow" event');
			});
		} catch (error) {
			logger.error('enableBotDataProducer() | failed:%o', error);

			store.dispatch(
				requestActions.notify({
					type: 'error',
					text: `Error enabling bot DataProducer: ${error}`,
				})
			);

			throw error;
		}
	}

	async sendChatMessage(text) {
		logger.debug('sendChatMessage() [text:"%s]', text);

		if (!this._chatDataProducer) {
			store.dispatch(
				requestActions.notify({
					type: 'error',
					text: 'No chat DataProducer',
				})
			);

			return;
		}

		try {
			this._chatDataProducer.send(text);
		} catch (error) {
			logger.error('chat DataProducer.send() failed:%o', error);

			store.dispatch(
				requestActions.notify({
					type: 'error',
					text: `chat DataProducer.send() failed: ${error}`,
				})
			);
		}
	}

	async sendBotMessage(text) {
		logger.debug('sendBotMessage() [text:"%s]', text);

		if (!this._botDataProducer) {
			store.dispatch(
				requestActions.notify({
					type: 'error',
					text: 'No bot DataProducer',
				})
			);

			return;
		}

		try {
			this._botDataProducer.send(text);
		} catch (error) {
			logger.error('bot DataProducer.send() failed:%o', error);

			store.dispatch(
				requestActions.notify({
					type: 'error',
					text: `bot DataProducer.send() failed: ${error}`,
				})
			);
		}
	}

	async changeDisplayName(displayName) {
		logger.debug('changeDisplayName() [displayName:"%s"]', displayName);

		// Store in cookie.
		cookiesManager.setUser({ displayName });

		try {
			await this._protoo.request('changeDisplayName', { displayName });

			this._displayName = displayName;

			store.dispatch(stateActions.setDisplayName(displayName));

			store.dispatch(
				requestActions.notify({
					text: 'Display name changed',
				})
			);
		} catch (error) {
			logger.error('changeDisplayName() | failed: %o', error);

			store.dispatch(
				requestActions.notify({
					type: 'error',
					text: `Could not change display name: ${error}`,
				})
			);

			// We need to refresh the component for it to render the previous
			// displayName again.
			store.dispatch(stateActions.setDisplayName());
		}
	}

	async getSendTransportRemoteStats() {
		logger.debug('getSendTransportRemoteStats()');

		if (!this._sendTransport) return;

		return this._protoo.request('getTransportStats', {
			transportId: this._sendTransport.id,
		});
	}

	async getRecvTransportRemoteStats() {
		logger.debug('getRecvTransportRemoteStats()');

		if (!this._recvTransport) return;

		return this._protoo.request('getTransportStats', {
			transportId: this._recvTransport.id,
		});
	}

	async getAudioRemoteStats() {
		logger.debug('getAudioRemoteStats()');

		if (!this._micProducer) return;

		return this._protoo.request('getProducerStats', {
			producerId: this._micProducer.id,
		});
	}

	async getVideoRemoteStats() {
		logger.debug('getVideoRemoteStats()');

		const producer = this._webcamProducer || this._shareProducer;

		if (!producer) return;

		return this._protoo.request('getProducerStats', {
			producerId: producer.id,
		});
	}

	async getConsumerRemoteStats(consumerId) {
		logger.debug('getConsumerRemoteStats()');

		const consumer = this._consumers.get(consumerId);

		if (!consumer) return;

		return this._protoo.request('getConsumerStats', { consumerId });
	}

	async getChatDataProducerRemoteStats() {
		logger.debug('getChatDataProducerRemoteStats()');

		const dataProducer = this._chatDataProducer;

		if (!dataProducer) return;

		return this._protoo.request('getDataProducerStats', {
			dataProducerId: dataProducer.id,
		});
	}

	async getBotDataProducerRemoteStats() {
		logger.debug('getBotDataProducerRemoteStats()');

		const dataProducer = this._botDataProducer;

		if (!dataProducer) return;

		return this._protoo.request('getDataProducerStats', {
			dataProducerId: dataProducer.id,
		});
	}

	async getDataConsumerRemoteStats(dataConsumerId) {
		logger.debug('getDataConsumerRemoteStats()');

		const dataConsumer = this._dataConsumers.get(dataConsumerId);

		if (!dataConsumer) return;

		return this._protoo.request('getDataConsumerStats', { dataConsumerId });
	}

	async getSendTransportLocalStats() {
		logger.debug('getSendTransportLocalStats()');

		if (!this._sendTransport) return;

		return this._sendTransport.getStats();
	}

	async getRecvTransportLocalStats() {
		logger.debug('getRecvTransportLocalStats()');

		if (!this._recvTransport) return;

		return this._recvTransport.getStats();
	}

	async getAudioLocalStats() {
		logger.debug('getAudioLocalStats()');

		if (!this._micProducer) return;

		return this._micProducer.getStats();
	}

	async getVideoLocalStats() {
		logger.debug('getVideoLocalStats()');

		const producer = this._webcamProducer || this._shareProducer;

		if (!producer) return;

		return producer.getStats();
	}

	async getConsumerLocalStats(consumerId) {
		const consumer = this._consumers.get(consumerId);

		if (!consumer) return;

		return consumer.getStats();
	}

	async applyNetworkThrottle({ uplink, downlink, rtt, secret, packetLoss }) {
		logger.debug(
			'applyNetworkThrottle() [uplink:%s, downlink:%s, rtt:%s, packetLoss:%s]',
			uplink,
			downlink,
			rtt,
			packetLoss
		);

		try {
			await this._protoo.request('applyNetworkThrottle', {
				secret,
				uplink,
				downlink,
				rtt,
				packetLoss,
			});
		} catch (error) {
			logger.error('applyNetworkThrottle() | failed:%o', error);

			store.dispatch(
				requestActions.notify({
					type: 'error',
					text: `Error applying network throttle: ${error}`,
				})
			);
		}
	}

	async resetNetworkThrottle({ silent = false, secret }) {
		logger.debug('resetNetworkThrottle()');

		try {
			await this._protoo.request('resetNetworkThrottle', { secret });
		} catch (error) {
			if (!silent) {
				logger.error('resetNetworkThrottle() | failed:%o', error);

				store.dispatch(
					requestActions.notify({
						type: 'error',
						text: `Error resetting network throttle: ${error}`,
					})
				);
			}
		}
	}

	async _joinRoom() {
		logger.debug('_joinRoom()');

		try {
			logger.debug('_joinRoom() | using mediasoupClient.Device.factory()');

			this._mediasoupDevice = await mediasoupClient.Device.factory({
				handlerName: this._handlerName,
			});

			store.dispatch(
				stateActions.setRoomMediasoupClientHandler(
					this._mediasoupDevice.handlerName
				)
			);

			const routerRtpCapabilities = await this._protoo.request(
				'getRouterRtpCapabilities'
			);

			await this._mediasoupDevice.load({
				routerRtpCapabilities,
				preferLocalCodecsOrder: this._preferLocalCodecsOrder,
			});

			// NOTE: Stuff to play remote audios due to browsers' new autoplay policy.
			//
			// Just get access to the mic and DO NOT close the mic track for a while.
			// Super hack!
			{
				const stream = await navigator.mediaDevices.getUserMedia({
					audio: true,
				});
				const audioTrack = stream.getAudioTracks()[0];

				audioTrack.enabled = false;

				setTimeout(() => audioTrack.stop(), 120000);
			}
			// Create mediasoup Transport for sending (unless we don't want to produce).
			if (this._produce) {
				const transportInfo = await this._protoo.request(
					'createWebRtcTransport',
					{
						forceTcp: this._forceTcp,
						producing: true,
						consuming: false,
						sctpCapabilities: this._useDataChannel
							? this._mediasoupDevice.sctpCapabilities
							: undefined,
					}
				);

				const {
					id,
					iceParameters,
					iceCandidates,
					dtlsParameters,
					sctpParameters,
				} = transportInfo;

				this._sendTransport = this._mediasoupDevice.createSendTransport({
					id,
					iceParameters,
					iceCandidates,
					dtlsParameters: {
						...dtlsParameters,
						// Remote DTLS role. We know it's always 'auto' by default so, if
						// we want, we can force local WebRTC transport to be 'client' by
						// indicating 'server' here and vice-versa.
						role: 'auto',
					},
					sctpParameters,
					iceServers: [],
					proprietaryConstraints: PC_PROPRIETARY_CONSTRAINTS,
					additionalSettings: {
						encodedInsertableStreams: this._e2eKey && e2e.isSupported(),
					},
				});

				this._sendTransport.on(
					'connect',
					(
						{ iceParameters, dtlsParameters },
						callback,
						errback // eslint-disable-line no-shadow
					) => {
						this._protoo
							.request('connectWebRtcTransport', {
								transportId: this._sendTransport.id,
								iceParameters,
								dtlsParameters,
							})
							.then(callback)
							.catch(errback);
					}
				);

				this._sendTransport.on(
					'produce',
					async ({ kind, rtpParameters, appData }, callback, errback) => {
						try {
							// eslint-disable-next-line no-shadow
							const { id } = await this._protoo.request('produce', {
								transportId: this._sendTransport.id,
								kind,
								rtpParameters,
								appData,
							});

							callback({ id });
						} catch (error) {
							errback(error);
						}
					}
				);

				this._sendTransport.on(
					'producedata',
					async (
						{ sctpStreamParameters, label, protocol, appData },
						callback,
						errback
					) => {
						logger.debug(
							'"producedata" event: [sctpStreamParameters:%o, appData:%o]',
							sctpStreamParameters,
							appData
						);

						try {
							// eslint-disable-next-line no-shadow
							const { id } = await this._protoo.request('produceData', {
								transportId: this._sendTransport.id,
								sctpStreamParameters,
								label,
								protocol,
								appData,
							});

							callback({ id });
						} catch (error) {
							errback(error);
						}
					}
				);
			}

			// Create mediasoup Transport for receiving (unless we don't want to consume).
			if (this._consume) {
				const transportInfo = await this._protoo.request(
					'createWebRtcTransport',
					{
						forceTcp: this._forceTcp,
						producing: false,
						consuming: true,
						sctpCapabilities: this._useDataChannel
							? this._mediasoupDevice.sctpCapabilities
							: undefined,
					}
				);

				const {
					id,
					iceParameters,
					iceCandidates,
					dtlsParameters,
					sctpParameters,
				} = transportInfo;

				this._recvTransport = this._mediasoupDevice.createRecvTransport({
					id,
					iceParameters,
					iceCandidates,
					dtlsParameters: {
						...dtlsParameters,
						// Remote DTLS role. We know it's always 'auto' by default so, if
						// we want, we can force local WebRTC transport to be 'client' by
						// indicating 'server' here and vice-versa.
						role: 'auto',
					},
					sctpParameters,
					iceServers: [],
					additionalSettings: {
						encodedInsertableStreams: this._e2eKey && e2e.isSupported(),
					},
				});

				this._recvTransport.on(
					'connect',
					(
						{ iceParameters, dtlsParameters },
						callback,
						errback // eslint-disable-line no-shadow
					) => {
						this._protoo
							.request('connectWebRtcTransport', {
								transportId: this._recvTransport.id,
								iceParameters,
								dtlsParameters,
							})
							.then(callback)
							.catch(errback);
					}
				);
			}

			// Join now into the room.
			// NOTE: Don't send our RTP capabilities if we don't want to consume.
			const { peers } = await this._protoo.request('join', {
				displayName: this._displayName,
				device: this._device,
				rtpCapabilities: this._consume
					? this._mediasoupDevice.rtpCapabilities
					: undefined,
				sctpCapabilities:
					this._useDataChannel && this._consume
						? this._mediasoupDevice.sctpCapabilities
						: undefined,
			});

			store.dispatch(stateActions.setRoomState('connected'));

			// Clean all the existing notifcations.
			store.dispatch(stateActions.removeAllNotifications());

			store.dispatch(
				requestActions.notify({
					text: 'You are in the room!',
					timeout: 3000,
				})
			);

			for (const peer of peers) {
				store.dispatch(
					stateActions.addPeer({ ...peer, consumers: [], dataConsumers: [] })
				);
			}

			// Enable mic/webcam.
			if (this._produce) {
				// Set our media capabilities.
				store.dispatch(
					stateActions.setMediaCapabilities({
						canSendMic: this._mediasoupDevice.canProduce('audio'),
						canSendWebcam: this._mediasoupDevice.canProduce('video'),
					})
				);

				if (this._useMic) {
					this.enableMic();
				}

				const devicesCookie = cookiesManager.getDevices();

				if (
					this._useWebcam ||
					(this._useWebcam === undefined &&
						(!devicesCookie || devicesCookie.webcamEnabled)) ||
					this._externalVideo
				)
					this.enableWebcam();

				if (this._useDataChannel) {
					this.enableChatDataProducer();
					this.enableBotDataProducer();
				}
			}

			if (this._stats) {
				const { me } = store.getState();

				store.dispatch(stateActions.setRoomStatsPeerId(me.id));
			}

			// Enable QoE logging after joining
			// You can make this configurable via URL parameters
			const urlParams = new URLSearchParams(window.location.search);
			const enableQoE = urlParams.get('qoe') === 'true';
			const qoeInterval = parseInt(urlParams.get('qoeInterval')) || 2000;

			if (enableQoE) {
				logger.debug('Enabling QoE logging with %d ms interval', qoeInterval);
				this._qoeManager.enable(qoeInterval);
			}

			// Prevent auto audio-only for external video broadcasting
			if (this._externalVideo) {
				this._preventAutoAudioOnly();
				
				// Set up periodic check to ensure video consumers stay active
				setInterval(() => {
					this._preventAutoAudioOnly();
				}, 5000); // Check every 5 seconds
			}
		} catch (error) {
			logger.error('_joinRoom() failed:%o', error);

			store.dispatch(
				requestActions.notify({
					type: 'error',
					text: `Could not join the room: ${error}`,
				})
			);

			this.close();
		}
	}

	async _updateWebcams() {
		logger.debug('_updateWebcams()');

		// Reset the list.
		this._webcams = new Map();

		logger.debug('_updateWebcams() | calling enumerateDevices()');

		const devices = await navigator.mediaDevices.enumerateDevices();

		for (const device of devices) {
			if (device.kind !== 'videoinput') continue;

			this._webcams.set(device.deviceId, device);
		}

		const array = Array.from(this._webcams.values());
		const len = array.length;
		const currentWebcamId = this._webcam.device
			? this._webcam.device.deviceId
			: undefined;

		logger.debug('_updateWebcams() [webcams:%o]', array);

		if (len === 0) this._webcam.device = null;
		else if (!this._webcams.has(currentWebcamId))
			this._webcam.device = array[0];

		store.dispatch(stateActions.setCanChangeWebcam(this._webcams.size > 1));
	}

	_getWebcamType(device) {
		if (/(back|rear)/i.test(device.label)) {
			logger.debug('_getWebcamType() | it seems to be a back camera');

			return 'back';
		} else {
			logger.debug('_getWebcamType() | it seems to be a front camera');

			return 'front';
		}
	}

	async _pauseConsumer(consumer) {
		if (consumer.paused) return;

		try {
			await this._protoo.request('pauseConsumer', { consumerId: consumer.id });

			consumer.pause();

			store.dispatch(stateActions.setConsumerPaused(consumer.id, 'local'));
		} catch (error) {
			logger.error('_pauseConsumer() | failed:%o', error);

			store.dispatch(
				requestActions.notify({
					type: 'error',
					text: `Error pausing Consumer: ${error}`,
				})
			);
		}
	}

	async _resumeConsumer(consumer) {
		if (!consumer.paused) return;

		try {
			await this._protoo.request('resumeConsumer', { consumerId: consumer.id });

			consumer.resume();

			store.dispatch(stateActions.setConsumerResumed(consumer.id, 'local'));
		} catch (error) {
			logger.error('_resumeConsumer() | failed:%o', error);

			store.dispatch(
				requestActions.notify({
					type: 'error',
					text: `Error resuming Consumer: ${error}`,
				})
			);
		}
	}

	/**
	 * Prevent automatic audio-only mode for external video broadcasting
	 */
	_preventAutoAudioOnly() {
		if (this._externalVideo) {
			// Override the audio-only state to false for external video
			store.dispatch(stateActions.setAudioOnlyState(false));
			
			// Ensure all video consumers are resumed
			for (const consumer of this._consumers.values()) {
				if (consumer.kind === 'video' && consumer.paused) {
					this._resumeConsumer(consumer);
				}
			}
		}
	}

	async _getExternalVideoStream() {
		if (this._externalVideoStream) return this._externalVideoStream;

		if (this._externalVideo.readyState < 3) {
			await new Promise(resolve =>
				this._externalVideo.addEventListener('canplay', resolve)
			);
		}

		// Ensure it is actually playing before capturing
		if (this._externalVideo.paused) {
			try {
				await this._externalVideo.play();
			} catch (error) {
				logger.warn('externalVideo.play() failed:%o', error);
			}
		}

		if (this._externalVideo.captureStream)
			this._externalVideoStream = this._externalVideo.captureStream();
		else if (this._externalVideo.mozCaptureStream)
			this._externalVideoStream = this._externalVideo.mozCaptureStream();
		else throw new Error('video.captureStream() not supported');

		return this._externalVideoStream;
	}

	/**
	 * Enable QoE logging
	 * @param {number} intervalMs - Logging interval in milliseconds
	 * @param {number} csvSaveIntervalMs - CSV save interval in milliseconds
	 */
	enableQoELogging(intervalMs = 2000, csvSaveIntervalMs = 10000) {
		this._qoeManager.enable(intervalMs, csvSaveIntervalMs);
	}

	/**
	 * Disable QoE logging
	 */
	disableQoELogging() {
		this._qoeManager.disable();
	}

	/**
	 * Get QoE Manager instance for advanced operations
	 * @returns {QoEManager} QoE Manager instance
	 */
	get qoeManager() {
		return this._qoeManager;
	}

	/**
	 * Get QoE metrics for all consumers
	 * @returns {Object} QoE metrics
	 */
	getQoEMetrics() {
		return this._qoeManager.getAllMetrics();
	}

	/**
	 * Get QoE metrics for a specific consumer
	 * @param {string} consumerId - Consumer ID
	 * @returns {Object|null} QoE metrics
	 */
	getConsumerQoEMetrics(consumerId) {
		return this._qoeManager.getConsumerMetrics(consumerId);
	}

	/**
	 * Export QoE data as CSV
	 * @returns {string} CSV data
	 */
	exportQoEAsCSV() {
		return this._qoeManager.exportAsCSV();
	}

	/**
	 * Set QoE CSV save interval
	 * @param {number} intervalMs - Interval in milliseconds
	 */
	setQoECSVSaveInterval(intervalMs) {
		this._qoeManager.setCSVSaveInterval(intervalMs);
	}

	/**
	 * Manually save QoE CSV data
	 */
	saveQoECSV() {
		this._qoeManager.manualSaveCSV();
	}

	/**
	 * Get stored QoE CSV files
	 * @returns {Array} Array of stored files
	 */
	getStoredQoEFiles() {
		return this._qoeManager.getStoredCSVFiles();
	}

	/**
	 * Clear all stored QoE CSV files
	 */
	clearQoEFiles() {
		this._qoeManager.clearStoredCSVFiles();
	}

	/**
	 * Get QoE storage statistics
	 * @returns {Object} Storage statistics
	 */
	getQoEStorageStats() {
		return this._qoeManager.getStorageStats();
	}

	/**
	 * Change video source dynamically
	 * @param {string} newVideoSource - New video source path or name
	 */
	async changeVideoSource(newVideoSource) {
		if (!this._externalVideo) {
			logger.warn('External video not enabled');
			return;
		}

		const newSrc = getExternalVideoSrc(newVideoSource);
		if (newSrc === this._currentVideoSrc) {
			logger.debug('Video source unchanged');
			return;
		}

		logger.debug('Changing video source to: %s', newSrc);
		
		this._currentVideoSrc = newSrc;
		this._externalVideo.src = newSrc;
		
		try {
			await this._externalVideo.play();
			
			// If currently broadcasting, restart webcam to use new video source
			if (this._webcamProducer && !this._webcamProducer.closed) {
				await this.disableWebcam();
				await this.enableWebcam();
			}
		} catch (error) {
			logger.error('Failed to change video source: %o', error);
		}
	}

	/**
	 * Get available video list
	 * @returns {Array} Array of available videos
	 */
	getAvailableVideos() {
		return DEFAULT_VIDEOS.map(src => ({
			path: src,
			name: src.split('/').pop().replace(/\.[^/.]+$/, "")
		}));
	}

	/**
	 * Get current video source
	 * @returns {string} Current video source path
	 */
	getCurrentVideoSource() {
		return this._currentVideoSrc;
	}
}
