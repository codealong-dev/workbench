import { Socket } from "phoenix";

const token = document.querySelector<HTMLMetaElement>('meta[name="wb-token"]')?.content ?? "";

export const socket = new Socket("/socket", { params: { token } });
socket.connect();

export const hasToken = token !== "";
