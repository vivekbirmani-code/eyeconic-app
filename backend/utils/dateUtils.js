/**
 * Backend utility for IST date formatting.
 * Used primarily for error messages to ensure students see IST times.
 */

const formatToIST = (date) => {
  if (!date) return '';
  
  const d = typeof date === 'string' ? new Date(date) : date;
  
  if (isNaN(d.getTime())) return '';

  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: true
  }).format(d) + ' IST';
};

module.exports = {
  formatToIST
};
