export const EXCLUDED_TRANSLATION_HOSTS_STORAGE_KEY = 'excludedTranslationHosts';
export const DEFAULT_EXCLUDED_TRANSLATION_HOSTS = [
  '12306.cn',
  '1688.com',
  '36kr.com',
  '::1',
  '10.0.0.1',
  '10.0.1.1',
  'acfun.cn',
  'alibaba.com',
  'alicdn.com',
  'alipay.com',
  'aliyun.com',
  'amap.com',
  'baidu.com',
  'bdstatic.com',
  'bilibili.com',
  'biligame.com',
  'bytedance.com',
  'china.com',
  'chinaz.com',
  'cnblogs.com',
  'csdn.net',
  'ctrip.com',
  'dianping.com',
  'dingtalk.com',
  'douban.com',
  'douyin.com',
  'eastmoney.com',
  'feishu.cn',
  'gaode.com',
  'huawei.com',
  'huya.com',
  'ifeng.com',
  'iqiyi.com',
  'jd.com',
  'juejin.cn',
  'kuaishou.com',
  'lan',
  'le.com',
  'leike.cc',
  'local',
  'localhost',
  'mafengwo.cn',
  'meituan.com',
  'melogin.cn',
  'mgtv.com',
  'mi.com',
  'miwifi.com',
  'my.router',
  'netease.com',
  'pinduoduo.com',
  'qq.com',
  'qidian.com',
  'qunar.com',
  'router.asus.com',
  'routerlogin.com',
  'routerlogin.net',
  'sina.com.cn',
  'smzdm.com',
  'sohu.com',
  'sogou.com',
  'taobao.com',
  'tencent.com',
  'tencentcloud.com',
  'tendawifi.com',
  'thepaper.cn',
  'tmall.com',
  'toutiao.com',
  'tplogin.cn',
  'weibo.com',
  'weixin.qq.com',
  'xiaohongshu.com',
  'xiaomi.com',
  'ximalaya.com',
  'youku.com',
  'zhihu.com'
];

export function normalizeTranslationHostname(value) {
  const rawValue = String(value || '').trim().toLowerCase();
  if (!rawValue) {
    return '';
  }

  const hostname = rawValue.includes('://')
    ? getHostnameFromUrl(rawValue)
    : rawValue.split('/')[0];

  return stripHostnamePort(hostname).replace(/^www\./, '');
}

export function getHostnameFromUrl(urlLike) {
  try {
    return new URL(urlLike).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function normalizeExcludedTranslationHosts(hosts) {
  return [...new Set(
    (Array.isArray(hosts) ? hosts : [])
      .map(normalizeTranslationHostname)
      .filter(Boolean)
  )].sort();
}

export function isTranslationHostExcluded(urlOrHost, excludedHosts) {
  const hostname = normalizeTranslationHostname(urlOrHost);
  if (!hostname) {
    return false;
  }

  if (isPrivateTranslationHostname(hostname)) {
    return true;
  }

  return normalizeExcludedTranslationHosts(excludedHosts).some((excludedHost) => (
    hostname === excludedHost || hostname.endsWith(`.${excludedHost}`)
  ));
}

export function isPrivateTranslationHostname(hostname) {
  const normalizedHostname = normalizeTranslationHostname(hostname);
  if (
    normalizedHostname === 'localhost'
    || normalizedHostname === '::1'
    || normalizedHostname.endsWith('.localhost')
    || normalizedHostname.endsWith('.local')
    || normalizedHostname.endsWith('.lan')
    || normalizedHostname.endsWith('.home.arpa')
  ) {
    return true;
  }

  const parts = normalizedHostname.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) {
    return false;
  }

  const octets = parts.map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) {
    return false;
  }

  const [first, second] = octets;
  return first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

export function setTranslationHostExcluded(excludedHosts, urlOrHost, excluded) {
  const hostname = normalizeTranslationHostname(urlOrHost);
  const hosts = new Set(normalizeExcludedTranslationHosts(excludedHosts));
  if (!hostname) {
    return [...hosts];
  }

  if (excluded) {
    hosts.add(hostname);
  } else {
    hosts.delete(hostname);
  }

  return [...hosts].sort();
}

function stripHostnamePort(hostname) {
  const value = String(hostname || '').replace(/^\[/, '').replace(/\]$/, '');
  if (!value.includes('::') && /^[^:]+:\d+$/.test(value)) {
    return value.replace(/:\d+$/, '');
  }

  return value;
}
