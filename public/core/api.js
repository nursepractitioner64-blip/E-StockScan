export async function getMovement(id) {
  const res = await fetch(`/api/movement/${id}`);
  return res.json();
}

export async function getSessionUsers() {
  const res = await fetch("/api/users");
  return res.json();
}

export async function createSession() {
  const res = await fetch("/api/session/new");
  return res.json();
}