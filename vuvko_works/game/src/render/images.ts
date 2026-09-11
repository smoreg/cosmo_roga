/** Loading a tile, in the one place that does it. */
export function loadImage(src: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise(function attempt(resolve, reject) {
    const image = new Image();
    image.decoding = "async";
    image.onload = function done() {
      resolve(image);
    };
    image.onerror = function failed() {
      reject(new Error(`could not load tile: ${src}`));
    };
    signal?.addEventListener("abort", function cancel() {
      image.src = "";
      reject(new Error("aborted"));
    });
    image.src = src;
  });
}
