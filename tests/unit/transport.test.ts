import { describe, it, expect, beforeEach } from 'vitest';
import { MockTransport } from '../../src/transport.js';
import { TransportError } from '../../src/errors.js';

describe('MockTransport', () => {
  let transport: MockTransport;

  beforeEach(() => {
    transport = new MockTransport();
  });

  describe('receive', () => {
    it('should return queued response immediately', async () => {
      transport.queueResponse({ type: 'STATUS', status_class: '00000' });

      const data = await transport.receive();
      const parsed = JSON.parse(data.toString());

      expect(parsed.type).toBe('STATUS');
    });

    it('should wait for response when queue is empty', async () => {
      const receivePromise = transport.receive();

      // Response should not resolve immediately
      let resolved = false;
      void receivePromise.then(() => {
        resolved = true;
      });

      // Queue response after starting receive
      await new Promise((r) => setTimeout(r, 10));
      expect(resolved).toBe(false);

      transport.queueResponse({ type: 'STATUS' });

      const data = await receivePromise;
      const parsed = JSON.parse(data.toString());
      expect(parsed.type).toBe('STATUS');
    });

    it('should reject when abort signal fires', async () => {
      const controller = new AbortController();

      const receivePromise = transport.receive(controller.signal);

      // Abort after a short delay
      setTimeout(() => controller.abort(), 5);

      await expect(receivePromise).rejects.toThrow(TransportError);
    });

    it('should not lose data when abort signal fires - CRITICAL BUG FIX', async () => {
      // This test verifies the fix for the critical bug where data was lost
      // when an abort signal fired after the pending read was registered
      // but before data arrived

      const controller = new AbortController();

      // Start a receive with abort signal
      const receivePromise = transport.receive(controller.signal);

      // Abort the receive
      controller.abort();

      // The receive should reject
      await expect(receivePromise).rejects.toThrow(TransportError);

      // Now queue a response - this simulates data arriving after abort
      transport.queueResponse({ type: 'DATA1' });

      // A new receive should get the queued data, not hang forever
      const data = await transport.receive();
      const parsed = JSON.parse(data.toString());
      expect(parsed.type).toBe('DATA1');
    });

    it('should handle multiple sequential receives correctly', async () => {
      transport.queueResponse({ type: 'FIRST' });
      transport.queueResponse({ type: 'SECOND' });
      transport.queueResponse({ type: 'THIRD' });

      const first = await transport.receive();
      const second = await transport.receive();
      const third = await transport.receive();

      expect(JSON.parse(first.toString()).type).toBe('FIRST');
      expect(JSON.parse(second.toString()).type).toBe('SECOND');
      expect(JSON.parse(third.toString()).type).toBe('THIRD');
    });

    it('should handle aborted receive followed by successful receive', async () => {
      // First receive with abort
      const controller = new AbortController();
      const abortedReceive = transport.receive(controller.signal);
      controller.abort();
      await expect(abortedReceive).rejects.toThrow();

      // Queue data
      transport.queueResponse({ type: 'AFTER_ABORT' });

      // Second receive without abort should succeed
      const data = await transport.receive();
      expect(JSON.parse(data.toString()).type).toBe('AFTER_ABORT');
    });

    it('should handle rapid abort-receive cycles without data loss', async () => {
      // Simulate the inline frame check pattern used in queryAll()
      for (let i = 0; i < 5; i++) {
        const controller = new AbortController();
        const receivePromise = transport.receive(controller.signal);

        // Quick abort (simulating inline frame timeout)
        setTimeout(() => controller.abort(), 1);

        await expect(receivePromise).rejects.toThrow();
      }

      // Now queue a response
      transport.queueResponse({ type: 'FINAL' });

      // Should still be able to receive
      const data = await transport.receive();
      expect(JSON.parse(data.toString()).type).toBe('FINAL');
    });

    it('should reject immediately if signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(transport.receive(controller.signal)).rejects.toThrow(TransportError);
    });
  });

  describe('send', () => {
    it('should queue sent messages', async () => {
      await transport.send({ type: 'TEST', data: 'hello' });

      const messages = transport.getSentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: 'TEST', data: 'hello' });
    });

    it('should reject when closed', async () => {
      await transport.close();

      await expect(transport.send({ type: 'TEST' })).rejects.toThrow();
    });

    it('should reject when abort signal is aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(transport.send({ type: 'TEST' }, controller.signal)).rejects.toThrow(
        TransportError
      );
    });
  });

  describe('close', () => {
    it('should reject pending reads on close', async () => {
      const receivePromise = transport.receive();

      await transport.close();

      await expect(receivePromise).rejects.toThrow();
    });

    it('should mark transport as closed', async () => {
      expect(transport.isClosed()).toBe(false);

      await transport.close();

      expect(transport.isClosed()).toBe(true);
    });

    it('should be idempotent', async () => {
      await transport.close();
      await transport.close(); // Should not throw
    });
  });

  describe('isClosed', () => {
    it('should return false initially', () => {
      expect(transport.isClosed()).toBe(false);
    });

    it('should return true after close', async () => {
      await transport.close();
      expect(transport.isClosed()).toBe(true);
    });
  });

  describe('getAddress', () => {
    it('should return the mock address', () => {
      expect(transport.getAddress()).toBe('mock:3141');
    });
  });
});
