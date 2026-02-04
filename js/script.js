document.addEventListener('DOMContentLoaded', () => {
  const header = document.querySelector('.site-header');

  window.addEventListener('scroll', () => {
    header.style.boxShadow = window.scrollY > 60
      ? '0 10px 30px rgba(0,0,0,0.08)'
      : 'none';
  });

  // Editorial engagement hooks
  // - Reading time calculation
  // - Save / bookmark stories
  // - Subscriber-only story unlock
  // - Sponsored brand attribution
});

