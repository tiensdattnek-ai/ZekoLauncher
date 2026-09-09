/**
 * Zeko i18n — Việt (mặc định) & English.
 */
export const LANGS = {
  vi: { code: 'vi', label: 'Tiếng Việt', flag: '🇻🇳' },
  en: { code: 'en', label: 'English', flag: '🇬🇧' },
};

const dict = {
  vi: {
    'nav.dashboard': 'Bảng điều khiển',
    'nav.instances': 'Instance',
    'nav.downloads': 'Tải xuống',
    'nav.settings': 'Cài đặt',
    'dash.hero.title': 'Chào mừng trở lại, {name}',
    'dash.hero.sub': 'Zeko Launcher đã sẵn sàng. Máy bạn được đánh giá "{tier}" — hồ sơ hiệu năng đề xuất: {profile}.',
    'dash.play': 'CHƠI',
    'dash.quick': 'Thao tác nhanh',
    'dash.news': 'Tin mới',
    'dash.system': 'Hệ thống',
    'dash.fps': 'Giám sát FPS',
    'dash.risk': 'Độ an toàn',
    'dash.recent': 'Chơi gần đây',
    'instances.new': 'Instance mới',
    'instances.empty.title': 'Chưa có instance nào',
    'instances.empty.sub': 'Tạo instance đầu tiên để bắt đầu — chỉ mất vài giây.',
    'perf.title': 'Zeko Turbo',
    'perf.sub': 'Hồ sơ tối ưu FPS được hiệu chỉnh theo phần cứng thật của máy bạn',
    'sec.title': 'Zeko Sentinel',
    'sec.sub': 'Kiểm tra toàn vẹn và phát hiện tệp đáng ngờ trong thư mục game',
    'common.save': 'Lưu',
    'common.cancel': 'Huỷ',
    'common.delete': 'Xoá',
    'common.close': 'Đóng',
    'common.apply': 'Áp dụng',
    'common.refresh': 'Làm mới',
    'common.scanning': 'Đang quét…',
    'common.none': 'Không có',
    'common.loading': 'Đang tải…',
  },
  en: {
    'nav.dashboard': 'Dashboard',
    'nav.instances': 'Instances',
    'nav.downloads': 'Downloads',
    'nav.settings': 'Settings',
    'dash.hero.title': 'Welcome back, {name}',
    'dash.hero.sub': 'Zeko Launcher is ready. Your machine is rated "{tier}" — recommended profile: {profile}.',
    'dash.play': 'PLAY',
    'dash.quick': 'Quick actions',
    'dash.news': 'News',
    'dash.system': 'System',
    'dash.fps': 'FPS monitor',
    'dash.risk': 'Safety',
    'dash.recent': 'Recently played',
    'instances.new': 'New instance',
    'instances.empty.title': 'No instances yet',
    'instances.empty.sub': 'Create your first instance to get started — it takes seconds.',
    'perf.title': 'Zeko Turbo',
    'perf.sub': 'FPS profiles tuned against your real hardware',
    'sec.title': 'Zeko Sentinel',
    'sec.sub': 'Integrity checks and suspicious-file detection inside game folders',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.close': 'Close',
    'common.apply': 'Apply',
    'common.refresh': 'Refresh',
    'common.scanning': 'Scanning…',
    'common.none': 'None',
    'common.loading': 'Loading…',
  },
};

let current = 'vi';

export function setLang(code) {
  current = dict[code] ? code : 'vi';
  document.documentElement.lang = current;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
}

export function getLang() {
  return current;
}

export function t(key, vars = {}) {
  const table = dict[current] || dict.vi;
  let s = table[key] ?? dict.vi[key] ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

export function toggleLang() {
  setLang(current === 'vi' ? 'en' : 'vi');
  return current;
}
