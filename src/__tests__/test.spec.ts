// tslint:disable-next-line: no-submodule-imports
import { mocked } from 'ts-jest/utils'

import { DummyHID } from '../__mocks__/hid'
import { readFixtureJSON, validateWriteCall } from './helpers'

jest.mock('node-hid')
import { devices, HID } from 'node-hid'
mocked(devices).mockImplementation(() => [
	{
		// Original
		productId: 0x0060,
		vendorId: 0x0fd9,
		interface: 0,
		path: 'some_random_path_here',
		release: 0
	},
	{
		// Mini
		productId: 0x0063,
		vendorId: 0x0fd9,
		interface: 0,
		path: 'some_path_for_mini',
		release: 0
	}
])

// Forcing path to be string, as there are multiple constructor options, we require the string one
mocked(HID).mockImplementation((path: any) => new DummyHID(path))

// Must be required after we register a mock for `node-hid`.
import { StreamDeck } from '../'
import { DEVICE_MODELS, DeviceModel, DeviceModelId } from '../models'
import { bufferToIntArray } from '../util'

function getDeviceModelInfo(model: DeviceModelId) {
	const info = DEVICE_MODELS.find(d => d.MODEL_ID === model)
	expect(info).toBeTruthy()
	return info as DeviceModel
}

function runForDevice(modelId: DeviceModelId, path: string) {
	let streamDeck: StreamDeck
	const modelInfo = getDeviceModelInfo(modelId)
	function getDevice(sd?: StreamDeck): DummyHID {
		return (sd || (streamDeck as any)).device
	}

	beforeEach(() => {
		streamDeck = new StreamDeck(path)
	})

	test('errors if no devicePath is provided and there are no connected Stream Decks', () => {
		mocked(devices).mockImplementationOnce(() => [])
		expect(() => new StreamDeck()).toThrowError(new Error('No Stream Decks are connected.'))
	})

	test('checkValidKeyIndex', () => {
		expect(() => streamDeck.clearKey(-1)).toThrow()
		expect(() => streamDeck.clearKey(15)).toThrow()
	})

	test('clearKey', () => {
		streamDeck.fillColor = jest.fn()
		streamDeck.clearKey(0)
		expect(streamDeck.fillColor).toHaveBeenCalledTimes(1)
		expect(streamDeck.fillColor).toHaveBeenNthCalledWith(1, 0, 0, 0, 0)
	})

	test('clearAllKeys', () => {
		streamDeck.clearKey = jest.fn()
		streamDeck.clearAllKeys()

		const keyCount = modelInfo.KEY_COLS * modelInfo.KEY_ROWS
		expect(streamDeck.clearKey).toHaveBeenCalledTimes(keyCount)
		for (let i = 0; i < keyCount; i++) {
			expect(streamDeck.clearKey).toHaveBeenNthCalledWith(i + 1, i)
		}
	})

	test('fillImage throws on undersized buffers', () => {
		const smallBuffer = Buffer.alloc(1)

		expect(() => streamDeck.fillImage(0, smallBuffer)).toThrow()
	})

	test('forwards error events from the device', () => {
		const errorSpy = jest.fn()
		streamDeck.on('error', errorSpy)

		const device = getDevice()
		device.emit('error', new Error('Test'))

		expect(errorSpy).toHaveBeenCalledTimes(1)
		expect(errorSpy).toHaveBeenNthCalledWith(1, new Error('Test'))
	})

	test('setBrightness', () => {
		const device = getDevice()
		device.sendFeatureReport = jest.fn()

		streamDeck.setBrightness(100)
		streamDeck.setBrightness(0)

		expect(device.sendFeatureReport).toHaveBeenCalledTimes(2)
		// prettier-ignore
		expect(device.sendFeatureReport).toHaveBeenNthCalledWith(1, [0x05, 0x55, 0xaa, 0xd1, 0x01, 0x64, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
		// prettier-ignore
		expect(device.sendFeatureReport).toHaveBeenNthCalledWith(2, [0x05, 0x55, 0xaa, 0xd1, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])

		expect(() => streamDeck.setBrightness(101)).toThrow()
		expect(() => streamDeck.setBrightness(-1)).toThrow()
	})

	test('resetToLogo', () => {
		const device = getDevice()
		device.sendFeatureReport = jest.fn()

		streamDeck.resetToLogo()

		expect(device.sendFeatureReport).toHaveBeenCalledTimes(1)
		// prettier-ignore
		expect(device.sendFeatureReport).toHaveBeenNthCalledWith(1, [0x0B, 0x63, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
	})

	test('firmwareVersion', () => {
		const device = getDevice()
		device.getFeatureReport = () => {
			return [4, 85, 170, 212, 4, 49, 46, 48, 46, 49, 55, 48, 49, 51, 51, 0, 0]
		}

		const firmware = streamDeck.getFirmwareVersion()
		expect(firmware).toEqual('1.0.170133')
	})

	test('serialNumber', () => {
		const device = getDevice()
		device.getFeatureReport = () => {
			return [3, 85, 170, 211, 3, 65, 76, 51, 55, 71, 49, 65, 48, 50, 56, 52, 48]
		}

		const firmware = streamDeck.getSerialNumber()
		expect(firmware).toEqual('AL37G1A02840')
	})

	test('fillPanel', () => {
		const buffer = Buffer.alloc(streamDeck.NUM_KEYS * streamDeck.ICON_BYTES)

		const fillImageMock = jest.fn()
		;(streamDeck as any).fillImageRange = fillImageMock
		streamDeck.fillPanel(buffer)

		expect(fillImageMock).toHaveBeenCalledTimes(streamDeck.NUM_KEYS)

		const stride = streamDeck.KEY_COLUMNS * streamDeck.ICON_SIZE * 3
		for (let i = 0; i < streamDeck.NUM_KEYS; i++) {
			expect(fillImageMock).toHaveBeenCalledWith(i, expect.any(Buffer), expect.any(Number), stride)
			// Buffer has to be seperately as a deep equality check is really slow
			expect(fillImageMock.mock.calls[i][1]).toBe(buffer)
		}
	})

	test('fillPanel bad buffer', () => {
		const buffer = Buffer.alloc(100)

		const fillImageMock = jest.fn()
		;(streamDeck as any).fillImageRange = fillImageMock
		expect(() => streamDeck.fillPanel(buffer)).toThrow()

		expect(fillImageMock).toHaveBeenCalledTimes(0)
	})

	test('fillImage', () => {
		const buffer = Buffer.alloc(streamDeck.ICON_BYTES)

		const fillImageMock = jest.fn()
		;(streamDeck as any).fillImageRange = fillImageMock
		streamDeck.fillImage(2, buffer)

		expect(fillImageMock).toHaveBeenCalledTimes(1)
		expect(fillImageMock).toHaveBeenCalledWith(2, expect.any(Buffer), 0, modelInfo.IMAGE_SIZE * 3)
		// Buffer has to be seperately as a deep equality check is really slow
		expect(fillImageMock.mock.calls[0][1]).toBe(buffer)
	})

	test('fillImage bad key', () => {
		const buffer = Buffer.alloc(streamDeck.ICON_BYTES)

		const fillImageMock = jest.fn()
		;(streamDeck as any).fillImageRange = fillImageMock
		expect(() => streamDeck.fillImage(-1, buffer)).toThrow()
		expect(() => streamDeck.fillImage(streamDeck.NUM_KEYS + 1, buffer)).toThrow()

		expect(fillImageMock).toHaveBeenCalledTimes(0)
	})

	test('fillImage bad buffer', () => {
		const buffer = Buffer.alloc(100)

		const fillImageMock = jest.fn()
		;(streamDeck as any).fillImageRange = fillImageMock
		expect(() => streamDeck.fillImage(2, buffer)).toThrow()

		expect(fillImageMock).toHaveBeenCalledTimes(0)
	})

	test('fillColor', () => {
		const fillImageMock = jest.fn()
		;(streamDeck as any).fillImageRange = fillImageMock
		streamDeck.fillColor(4, 123, 255, 86)

		expect(fillImageMock).toHaveBeenCalledTimes(1)
		expect(fillImageMock).toHaveBeenCalledWith(4, expect.any(Buffer), 0, modelInfo.IMAGE_SIZE * 3)
		// console.log(JSON.stringify(bufferToIntArray(fillImageMock.mock.calls[0][1])))
		expect(bufferToIntArray(fillImageMock.mock.calls[0][1])).toEqual(readFixtureJSON('fillColor-buffer.json'))
	})

	test('fillColor bad rgb', () => {
		expect(() => streamDeck.fillColor(0, 256, 0, 0)).toThrow()
		expect(() => streamDeck.fillColor(0, 0, 256, 0)).toThrow()
		expect(() => streamDeck.fillColor(0, 0, 0, 256)).toThrow()
		expect(() => streamDeck.fillColor(0, -1, 0, 0)).toThrow()
	})

	test('fillColor bad key', () => {
		expect(() => streamDeck.fillColor(-1, 0, 0, 0)).toThrow()
		expect(() => streamDeck.fillColor(streamDeck.NUM_KEYS + 1, 0, 256, 0)).toThrow()
	})
}

describe('StreamDeck', () => {
	const devicePath = 'some_random_path_here'
	let streamDeck: StreamDeck
	function getDevice(sd?: StreamDeck): DummyHID {
		return (sd || (streamDeck as any)).device
	}

	beforeEach(() => {
		streamDeck = new StreamDeck(devicePath)
	})

	test('constructor uses the provided devicePath', () => {
		const streamDeck2 = new StreamDeck(devicePath)
		const device = getDevice(streamDeck2)
		expect(device.path).toEqual(devicePath)
		expect(streamDeck2.MODEL).toEqual(DeviceModelId.ORIGINAL)
	})

	runForDevice(DeviceModelId.ORIGINAL, devicePath)

	test('fillImage', () => {
		const device = getDevice()
		device.write = jest.fn()
		expect(device.write).toHaveBeenCalledTimes(0)
		streamDeck.fillImage(0, Buffer.from(readFixtureJSON('fillImage-sample-icon.json')))

		validateWriteCall(device.write, [
			'fillImage-sample-icon-original-page1.json',
			'fillImage-sample-icon-original-page2.json'
		])
	})

	test('down and up events', () => {
		const downSpy = jest.fn()
		const upSpy = jest.fn()
		streamDeck.on('down', downSpy)
		streamDeck.on('up', upSpy)

		const device = getDevice()
		// prettier-ignore
		device.emit('data', Buffer.from([0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))
		// prettier-ignore
		device.emit('data', Buffer.from([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))

		expect(downSpy).toHaveBeenCalledTimes(1)
		expect(upSpy).toHaveBeenCalledTimes(1)
		expect(downSpy).toHaveBeenNthCalledWith(1, 0)
		expect(upSpy).toHaveBeenNthCalledWith(1, 0)
	})
})

describe('StreamDeck Mini', () => {
	const devicePath = 'some_path_for_mini'
	let streamDeck: StreamDeck
	function getDevice(sd?: StreamDeck): DummyHID {
		return (sd || (streamDeck as any)).device
	}

	beforeEach(() => {
		streamDeck = new StreamDeck(devicePath)
	})

	test('constructor uses the provided devicePath', () => {
		const streamDeck2 = new StreamDeck(devicePath)
		const device = getDevice(streamDeck2)
		expect(device.path).toEqual(devicePath)
		expect(streamDeck2.MODEL).toEqual(DeviceModelId.MINI)
	})

	runForDevice(DeviceModelId.MINI, devicePath)

	test('fillImage', () => {
		const device = getDevice()
		device.write = jest.fn()
		expect(device.write).toHaveBeenCalledTimes(0)
		streamDeck.fillImage(0, Buffer.from(readFixtureJSON('fillImage-sample-icon.json')))

		// TODO - generate json files once this code has been tested with the mini
		// validateWriteCall(device.write, [
		// 	'fillImage-sample-icon-mini-page1.json',
		// 	'fillImage-sample-icon-mini-page2.json'
		// 	// etc
		// ])
	})

	test('down and up events', () => {
		const downSpy = jest.fn()
		const upSpy = jest.fn()
		streamDeck.on('down', downSpy)
		streamDeck.on('up', upSpy)

		const device = getDevice()
		// prettier-ignore
		device.emit('data', Buffer.from([0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))
		// prettier-ignore
		device.emit('data', Buffer.from([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))

		expect(downSpy).toHaveBeenCalledTimes(1)
		expect(upSpy).toHaveBeenCalledTimes(1)
		expect(downSpy).toHaveBeenNthCalledWith(1, 0)
		expect(upSpy).toHaveBeenNthCalledWith(1, 0)
	})
})
