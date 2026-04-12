const navIcons = document.querySelectorAll('.nav-bar .fa-solid');
const sections = document.querySelectorAll('.content-section');

navIcons.forEach(icon => {
  icon.addEventListener('click', () => {
    const targetId = icon.getAttribute('data-tab');

    navIcons.forEach(icon => icon.classList.remove('active'));
    icon.classList.add('active');

    sections.forEach(section => section.classList.remove('active'));
    document.getElementById(targetId)?.classList.add('active');
  });
});