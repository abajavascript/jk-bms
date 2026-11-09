export function ask(dialog, { message, hide = [] } = {}) {
  const text = dialog.querySelector('[data-message]');
  if (message != null && text) text.textContent = message;
  for (const button of dialog.querySelectorAll('button[data-choice]')) {
    button.hidden = hide.includes(button.dataset.choice);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      dialog.removeEventListener('click', onClick);
      dialog.removeEventListener('close', onClose);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const onClick = (event) => {
      const button = event.target.closest('button[data-choice]');
      if (button && dialog.contains(button)) finish(button.dataset.choice || null);
    };
    const onClose = () => finish(null);
    dialog.addEventListener('click', onClick);
    dialog.addEventListener('close', onClose);
    dialog.showModal();
  });
}
