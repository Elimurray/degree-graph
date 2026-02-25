'use strict'

/**
 * slugToCode.js
 *
 * Maps known University of Waikato subject-regulations URL slugs to structured
 * degree metadata (code, name, totalPoints).
 *
 * For unrecognised slugs the module returns a best-effort derived code by
 * uppercasing and kebab-case-ing the slug (e.g. "data-science" -> "DATA-SCIENCE").
 *
 * Usage:
 *   const { resolveDegreeFromSlug } = require('./slugToCode')
 *   const meta = resolveDegreeFromSlug('software-engineering')
 *   // { code: 'BE-SE', name: 'Bachelor of Engineering (Honours) in Software Engineering',
 *   //   totalPoints: 480 }
 */

/** Known degree slugs. Extend this list as more degrees are scraped. */
const KNOWN_SLUGS = {
  'software-engineering': {
    code: 'BE-SE',
    name: 'Bachelor of Engineering (Honours) in Software Engineering',
    totalPoints: 480,
  },
  'chemical-and-process-engineering': {
    code: 'BE-CBE',
    name: 'Bachelor of Engineering (Honours) in Chemical and Biological Engineering',
    totalPoints: 480,
  },
  'civil-engineering': {
    code: 'BE-CVL',
    name: 'Bachelor of Engineering (Honours) in Civil Engineering',
    totalPoints: 480,
  },
  'electrical-and-electronic-engineering': {
    code: 'BE-EEE',
    name: 'Bachelor of Engineering (Honours) in Electrical and Electronic Engineering',
    totalPoints: 480,
  },
  'environmental-engineering': {
    code: 'BE-ENV',
    name: 'Bachelor of Engineering (Honours) in Environmental Engineering',
    totalPoints: 480,
  },
  'materials-and-process-engineering': {
    code: 'BE-MPE',
    name: 'Bachelor of Engineering (Honours) in Materials and Process Engineering',
    totalPoints: 480,
  },
  'mechanical-engineering': {
    code: 'BE-MCH',
    name: 'Bachelor of Engineering (Honours) in Mechanical Engineering',
    totalPoints: 480,
  },
  'computer-science': {
    code: 'BCompSc',
    name: 'Bachelor of Computer Science',
    totalPoints: 360,
  },
  'data-science': {
    code: 'BDataSc',
    name: 'Bachelor of Data Science',
    totalPoints: 360,
  },
  'information-systems': {
    code: 'BIS',
    name: 'Bachelor of Information Systems',
    totalPoints: 360,
  },
  'cyber-security': {
    code: 'BCyberSec',
    name: 'Bachelor of Cyber Security',
    totalPoints: 360,
  },
}

/**
 * Derive a fallback degree code from an unrecognised slug.
 * "data-science" -> "DATA-SCIENCE"
 *
 * @param {string} slug
 * @returns {string}
 */
function slugToFallbackCode(slug) {
  return slug.toUpperCase()
}

/**
 * Derive a fallback degree name from an unrecognised slug.
 * "data-science" -> "Data Science"
 *
 * @param {string} slug
 * @returns {string}
 */
function slugToFallbackName(slug) {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Resolve degree metadata from a URL slug.
 *
 * @param {string} slug - e.g. "software-engineering"
 * @returns {{ code: string, name: string, totalPoints: number, known: boolean }}
 */
function resolveDegreeFromSlug(slug) {
  if (KNOWN_SLUGS[slug]) {
    return { ...KNOWN_SLUGS[slug], known: true }
  }

  return {
    code: slugToFallbackCode(slug),
    name: slugToFallbackName(slug),
    totalPoints: null,
    known: false,
  }
}

/**
 * Extract the slug from a full subject-regulations URL.
 * Handles:
 *   https://www.waikato.ac.nz/study/subject-regulations/software-engineering
 *   https://www.waikato.ac.nz/study/subject-regulations/software-engineering/
 *   software-engineering   (already a slug)
 *
 * @param {string} input - Full URL or slug string.
 * @returns {string} The extracted slug.
 */
function extractSlug(input) {
  const trimmed = input.trim().replace(/\/+$/, '')

  // If it looks like a URL, extract the last path segment
  if (/^https?:\/\//i.test(trimmed)) {
    const parts = trimmed.split('/')
    return parts[parts.length - 1]
  }

  // If it contains a slash, treat everything after the last slash as the slug
  if (trimmed.includes('/')) {
    const parts = trimmed.split('/')
    return parts[parts.length - 1]
  }

  // Already a slug
  return trimmed
}

/**
 * Build the full subject-regulations URL from a slug.
 *
 * @param {string} slug
 * @param {string} [baseUrl='https://www.waikato.ac.nz']
 * @returns {string}
 */
function buildRegulationsUrl(slug, baseUrl = 'https://www.waikato.ac.nz') {
  return `${baseUrl}/study/subject-regulations/${slug}`
}

module.exports = {
  resolveDegreeFromSlug,
  extractSlug,
  buildRegulationsUrl,
  KNOWN_SLUGS,
}
