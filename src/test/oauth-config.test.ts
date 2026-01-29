import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import {
	addOAuthClient,
	getOAuthClient,
	getOAuthConfigPath,
	isOAuthEnabled,
	listOAuthClients,
	loadOAuthConfig,
	removeOAuthClient,
} from '../lib/oauth/config.js';

describe('OAuth Config', () => {
	beforeEach(() => {
		// Set test config path
		process.env.XDG_CONFIG_HOME = '/tmp/mdq-test-oauth-config';
	});

	afterEach(() => {
		// Clean up test config
		try {
			const configPath = getOAuthConfigPath();
			if (fs.existsSync(configPath)) {
				fs.unlinkSync(configPath);
			}
			const configDir = configPath.substring(0, configPath.lastIndexOf('/'));
			if (fs.existsSync(configDir)) {
				fs.rmSync(configDir, { recursive: true });
			}
		} catch (error) {
			// Ignore cleanup errors
		}
	});

	describe('loadOAuthConfig', () => {
		test('returns disabled config when file does not exist', () => {
			const config = loadOAuthConfig();
			expect(config.enabled).toBe(false);
			expect(config.clients).toEqual([]);
		});

		test('loads existing config', () => {
			const client = {
				client_id: 'test-client',
				client_secret: 'test-secret',
				redirect_uris: ['http://localhost:8080/callback'],
				name: 'Test Client',
			};

			addOAuthClient(client);
			const config = loadOAuthConfig();

			expect(config.enabled).toBe(true);
			expect(config.clients).toHaveLength(1);
			expect(config.clients[0]?.client_id).toBe('test-client');
		});

		test('handles corrupt config file gracefully', () => {
			const configPath = getOAuthConfigPath();
			const configDir = configPath.substring(0, configPath.lastIndexOf('/'));
			fs.mkdirSync(configDir, { recursive: true });
			fs.writeFileSync(configPath, 'invalid json{');

			const config = loadOAuthConfig();
			expect(config.enabled).toBe(false);
			expect(config.clients).toEqual([]);
		});
	});

	describe('addOAuthClient', () => {
		test('adds client and enables OAuth', () => {
			const client = {
				client_id: 'test-client',
				client_secret: 'test-secret',
				redirect_uris: ['http://localhost:8080/callback'],
				name: 'Test Client',
			};

			addOAuthClient(client);

			const config = loadOAuthConfig();
			expect(config.enabled).toBe(true);
			expect(config.clients).toHaveLength(1);
		});

		test('throws error on duplicate client_id', () => {
			const client = {
				client_id: 'test-client',
				client_secret: 'test-secret',
				redirect_uris: ['http://localhost:8080/callback'],
				name: 'Test Client',
			};

			addOAuthClient(client);

			expect(() => addOAuthClient(client)).toThrow(/already exists/);
		});

		test('sets file permissions to 0600', () => {
			const client = {
				client_id: 'test-client',
				client_secret: 'test-secret',
				redirect_uris: ['http://localhost:8080/callback'],
				name: 'Test Client',
			};

			addOAuthClient(client);

			const configPath = getOAuthConfigPath();
			const stats = fs.statSync(configPath);
			// 0600 = 384 in decimal
			expect(stats.mode & 0o777).toBe(0o600);
		});
	});

	describe('removeOAuthClient', () => {
		test('removes client and returns true', () => {
			const client = {
				client_id: 'test-client',
				client_secret: 'test-secret',
				redirect_uris: ['http://localhost:8080/callback'],
				name: 'Test Client',
			};

			addOAuthClient(client);
			const removed = removeOAuthClient('test-client');

			expect(removed).toBe(true);
			const config = loadOAuthConfig();
			expect(config.clients).toHaveLength(0);
		});

		test('returns false when client not found', () => {
			const removed = removeOAuthClient('non-existent');
			expect(removed).toBe(false);
		});

		test('disables OAuth when last client removed', () => {
			const client = {
				client_id: 'test-client',
				client_secret: 'test-secret',
				redirect_uris: ['http://localhost:8080/callback'],
				name: 'Test Client',
			};

			addOAuthClient(client);
			removeOAuthClient('test-client');

			const config = loadOAuthConfig();
			expect(config.enabled).toBe(false);
		});

		test('keeps OAuth enabled when other clients remain', () => {
			const client1 = {
				client_id: 'client-1',
				client_secret: 'secret-1',
				redirect_uris: ['http://localhost:8080/callback'],
				name: 'Client 1',
			};

			const client2 = {
				client_id: 'client-2',
				client_secret: 'secret-2',
				redirect_uris: ['http://localhost:8080/callback'],
				name: 'Client 2',
			};

			addOAuthClient(client1);
			addOAuthClient(client2);
			removeOAuthClient('client-1');

			const config = loadOAuthConfig();
			expect(config.enabled).toBe(true);
			expect(config.clients).toHaveLength(1);
		});
	});

	describe('getOAuthClient', () => {
		test('returns client by ID', () => {
			const client = {
				client_id: 'test-client',
				client_secret: 'test-secret',
				redirect_uris: ['http://localhost:8080/callback'],
				name: 'Test Client',
			};

			addOAuthClient(client);
			const retrieved = getOAuthClient('test-client');

			expect(retrieved).toBeDefined();
			expect(retrieved?.client_id).toBe('test-client');
			expect(retrieved?.client_secret).toBe('test-secret');
		});

		test('returns undefined for non-existent client', () => {
			const retrieved = getOAuthClient('non-existent');
			expect(retrieved).toBeUndefined();
		});
	});

	describe('listOAuthClients', () => {
		test('returns empty array when no clients', () => {
			const clients = listOAuthClients();
			expect(clients).toEqual([]);
		});

		test('returns all clients', () => {
			const client1 = {
				client_id: 'client-1',
				client_secret: 'secret-1',
				redirect_uris: ['http://localhost:8080/callback'],
				name: 'Client 1',
			};

			const client2 = {
				client_id: 'client-2',
				client_secret: 'secret-2',
				redirect_uris: ['http://localhost:8080/callback'],
				name: 'Client 2',
			};

			addOAuthClient(client1);
			addOAuthClient(client2);

			const clients = listOAuthClients();
			expect(clients).toHaveLength(2);
		});
	});

	describe('isOAuthEnabled', () => {
		test('returns false when no clients', () => {
			expect(isOAuthEnabled()).toBe(false);
		});

		test('returns true when clients exist', () => {
			const client = {
				client_id: 'test-client',
				client_secret: 'test-secret',
				redirect_uris: ['http://localhost:8080/callback'],
				name: 'Test Client',
			};

			addOAuthClient(client);
			expect(isOAuthEnabled()).toBe(true);
		});
	});

	describe('getOAuthConfigPath', () => {
		test('uses XDG_CONFIG_HOME when set', () => {
			process.env.XDG_CONFIG_HOME = '/custom/config';
			const path = getOAuthConfigPath();
			expect(path).toBe('/custom/config/mdq/oauth.json');
		});

		test('uses ~/.config when XDG_CONFIG_HOME not set', () => {
			process.env.XDG_CONFIG_HOME = undefined;
			const path = getOAuthConfigPath();
			expect(path).toContain('.config/mdq/oauth.json');
		});
	});
});
