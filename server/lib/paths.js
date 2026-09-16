/**
 * Zeko Launcher — đường dẫn & cấu hình gốc
 * -------------------------------------------------------------
 * Mọi thứ người dùng tạo ra (instance, tệp game, vùng cách ly, báo cáo)
 * đều nằm trong Zeko Root để dễ sao lưu / di chuyển.
 *
 * Ghi đè bằng biến môi trường:
 *   ZEKO_ROOT=/duong/dan/khac
 *   ZEKO_PORT=8080
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const HOME = os.homedir();

/**
 * Chạy trên Vercel / AWS Lambda: filesystem chỉ ghi được /tmp (tạm thời).
 * Phát hiện qua biến môi trường đặc trưng của các nền tảng đó.
 */
export const IS_SERVERLESS = Boolean(
  process.env.VERCEL || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME
);

function defaultRoot() {
  if (IS_SERVERLESS) return '/tmp/zekolauncher'; // nơi duy nhất ghi được, dữ liệu sống tới hết phiên function
  switch (process.platform) {
    case 'win32':
      return path.join(process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'), 'ZekoLauncher');
    case 'darwin':
      return path.join(HOME, 'Library', 'Application Support', 'ZekoLauncher');
    default:
      return path.join(process.env.XDG_DATA_HOME || path.join(HOME, '.local', 'share'), 'zekolauncher');
  }
}

export const ZekoRoot = process.env.ZEKO_ROOT || defaultRoot();

export const Paths = {
  root: ZekoRoot,
  /** Thư viện dùng chung giữa các instance (giống .minecraft) */
  libraries: path.join(ZekoRoot, 'libraries'),
  assets: path.join(ZekoRoot, 'assets'),
  versions: path.join(ZekoRoot, 'versions'),
  javaRuntimes: path.join(ZekoRoot, 'java'),
  cache: path.join(ZekoRoot, 'cache'),
  /** Mỗi instance một thư mục riêng */
  instances: path.join(ZekoRoot, 'instances'),
  /** Tệp bị Zeko Sentinel cách ly */
  quarantine: path.join(ZekoRoot, 'quarantine'),
  reports: path.join(ZekoRoot, 'reports'),
  logs: path.join(ZekoRoot, 'logs'),
  modpacks: path.join(ZekoRoot, 'modpacks'),
  /** Cấu hình + cơ sở dữ liệu nhỏ của launcher */
  settingsFile: path.join(ZekoRoot, 'zeko.json'),
  dbFile: path.join(ZekoRoot, 'instances.json'),
};

/** Thư mục mã nguồn (để đọc catalog nhúng, phục vụ client) */
export const RepoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
export const DataDir = path.join(RepoRoot, 'server', 'data');
export const ClientDir = path.join(RepoRoot, 'client');

export function ensureDirs() {
  for (const key of ['root', 'libraries', 'assets', 'versions', 'javaRuntimes', 'cache', 'instances', 'quarantine', 'reports', 'logs', 'modpacks']) {
    fs.mkdirSync(Paths[key], { recursive: true });
  }
  return Paths;
}

export const PORT = Number(process.env.ZEKO_PORT || 4179);
export const HOST = process.env.ZEKO_HOST || '0.0.0.0';
export const APP_NAME = 'Zeko Launcher';
export const APP_VERSION = '1.0.0';
export const APP_CODENAME = 'Aurora';
