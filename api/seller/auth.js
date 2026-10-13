export default function handler(req, res) {
  if (res?.status) return res.status(404).json({ error: 'Not Found' });
}
