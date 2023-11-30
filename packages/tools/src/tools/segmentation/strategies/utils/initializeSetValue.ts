import type { InitializedOperationData } from '../BrushStrategy';

/**
 * Creates a set value function which will apply the specified segmentIndex
 * to the given location.
 * Uses a strategy pattern getPreviewSegmentIndex call to choose an alternate
 * segment index to use for preview colouring.
 */
export default {
  setValue: ({ value, index }, operationData: InitializedOperationData) => {
    const {
      segmentsLocked,
      segmentIndex,
      previewVoxelValue,
      previewSegmentIndex,
      segmentationVoxelValue,
    } = operationData;

    const existingValue = segmentationVoxelValue.getIndex(index);
    if (
      existingValue === segmentIndex ||
      existingValue === previewSegmentIndex ||
      segmentsLocked.includes(value)
    ) {
      return;
    }
    const useSegmentIndex = previewSegmentIndex ?? segmentIndex;

    previewVoxelValue.setIndex(index, useSegmentIndex);
  },
};
