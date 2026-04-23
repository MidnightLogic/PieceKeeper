/** 
* Copyright 2026 Craig Bailey
* Repository: https://github.com/MidnightLogic/PieceKeeper
*
* Licensed under the Apache License, Version 2.0
* SPDX-License-Identifier: Apache-2.0
*/

import en from '../i18n/en.json';
import es from '../i18n/es.json';
import zhCN from '../i18n/zh-CN.json';
import zhTW from '../i18n/zh-TW.json';
import hi from '../i18n/hi.json';
import ar from '../i18n/ar.json';
import fr from '../i18n/fr.json';
import bn from '../i18n/bn.json';
import ru from '../i18n/ru.json';
import pt from '../i18n/pt.json';
import de from '../i18n/de.json';
import ko from '../i18n/ko.json';
import ja from '../i18n/ja.json';
import he from '../i18n/he.json';
import id from '../i18n/id.json';
import it from '../i18n/it.json';
import tr from '../i18n/tr.json';
import vi from '../i18n/vi.json';
import th from '../i18n/th.json';
import nl from '../i18n/nl.json';
import pl from '../i18n/pl.json';

const translations = {
  en, es, 'zh-CN': zhCN, 'zh-TW': zhTW, hi, ar, fr, bn, ru, pt, de, ko, ja, he, id, it, tr, vi, th, nl, pl
};

/**
 * Normalizes a BCP-47 browser language tag to a supported locale key.
 * Handles hyphenated codes and regional Chinese fallback.
 * @param {string} tag - e.g. 'zh-TW', 'zh-Hans-CN', 'pt-BR', 'en-US'
 * @returns {string|null} - A key in the translations map, or null if unsupported.
 */
function resolveLocale(tag) {
  if (!tag) return null;
  const normalized = tag.toLowerCase().replace(/_/g, '-');

  // 1. Exact match (e.g. 'zh-cn', 'zh-tw')
  for (const key of Object.keys(translations)) {
    if (key.toLowerCase() === normalized) return key;
  }

  // 2. Chinese regional fallback
  if (normalized.startsWith('zh')) {
    // zh-TW, zh-HK, zh-MO, zh-Hant → Traditional
    if (/zh-(tw|hk|mo|hant)/.test(normalized)) return 'zh-TW';
    // zh, zh-CN, zh-SG, zh-Hans, anything else → Simplified
    return 'zh-CN';
  }

  // 3. Base language fallback (e.g. 'pt-BR' → 'pt', 'en-US' → 'en')
  const base = normalized.split('-')[0];
  if (translations[base]) return base;

  return null;
}

class I18n {
  constructor() {
    let autoLang = localStorage.getItem('autoLang');
    if (autoLang === null) autoLang = 'true'; // Default ON

    let savedLang;
    if (autoLang === 'true') {
      if (typeof navigator !== 'undefined' && navigator.language) {
        savedLang = resolveLocale(navigator.language);
      }
    } else {
      savedLang = localStorage.getItem('language');
      // Migrate legacy 'zh' saves
      if (savedLang === 'zh') savedLang = 'zh-CN';
    }
    this.currentLanguage = savedLang || 'en';
  }

  setLanguage(lang) {
    // Try exact match first, then resolve
    const resolved = translations[lang] ? lang : resolveLocale(lang);
    if (resolved && translations[resolved]) {
      this.currentLanguage = resolved;
      localStorage.setItem('language', resolved);
      this.applyTranslations();
      return true;
    }
    return false;
  }

  t(key) {
    const keys = key.split('.');
    let result = translations[this.currentLanguage];
    for (const k of keys) {
      if (result === undefined) return undefined;
      result = result[k];
    }
    return result;
  }

  applyTranslations() {
    // Query and map translations from data-i18n attributes in the DOM
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(element => {
      const key = element.getAttribute('data-i18n');
      const translation = this.t(key);
      
      if (translation === undefined) return;

      if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        if (element.hasAttribute('placeholder')) {
          element.setAttribute('placeholder', translation);
        }
      } else if (element.hasAttribute('data-html')) {
        element.innerHTML = translation;
      } else {
        let foundTextNode = false;
        for (let i = element.childNodes.length - 1; i >= 0; i--) {
          if (element.childNodes[i].nodeType === Node.TEXT_NODE && element.childNodes[i].textContent.trim() !== "") {
            element.childNodes[i].textContent = " " + translation;
            foundTextNode = true;
            break;
          }
        }
        if (!foundTextNode) {
          let existingSpan = element.querySelector('.i18n-dyn');
          if (existingSpan) {
            existingSpan.textContent = " " + translation;
          } else if (element.children.length === 0) {
            element.textContent = translation;
          } else {
            const span = document.createElement('span');
            span.className = 'i18n-dyn';
            span.textContent = " " + translation;
            element.appendChild(span);
          }
        }
      }
    });

    const closeIcon = document.getElementById('closeQrScannerModal');
    if (closeIcon) closeIcon.title = this.t('scanner.close_btn') || "Close Scanner";

    const sel = document.getElementById('language-select');
    if (sel && sel.value !== this.currentLanguage) {
      sel.value = this.currentLanguage;
    }
    document.title = this.t('nav.title') || "PieceKeeper";
  }
}

export const i18n = new I18n();
