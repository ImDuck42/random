const tabs = document.querySelectorAll('.nav-bar .fa-solid');
const sections = document.querySelectorAll('.content-section');

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const targetId = tab.getAttribute('data-tab');

    tabs.forEach(tab => tab.classList.remove('active'));
    tab.classList.add('active');

    sections.forEach(section => section.classList.remove('active'));

    document.getElementById(targetId)?.classList.add('active');
  });
});