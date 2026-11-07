import '@testing-library/jest-dom';

// jsdom stub for window.scrollTo
if (typeof window !== 'undefined') {
  window.scrollTo = () => {};
}
