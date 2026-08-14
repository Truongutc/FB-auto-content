const FOOTER = 'Sức mạnh AI: https://aic-proweb.vercel.app/';

function withFooter(message) {
  return `${message}\n\n—\n${FOOTER}`;
}

module.exports = { withFooter };
