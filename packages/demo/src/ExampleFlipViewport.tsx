import React, { Component } from 'react';
import {
  cache,
  RenderingEngine,
  volumeLoader,
  Enums,
  CONSTANTS,
  init as csRenderInit,
  setVolumesForViewports,
} from '@cornerstonejs/core';
import {
  synchronizers,
  Enums as csToolsEnums,
  WindowLevelTool,
} from '@cornerstonejs/tools';
import * as csTools3d from '@cornerstonejs/tools';

import getImageIds from './helpers/getImageIds';
import ViewportGrid from './components/ViewportGrid';
import { initToolGroups, addToolsToToolGroups } from './initToolGroups';
import './ExampleVTKMPR.css';
import {
  renderingEngineId,
  ctVolumeId,
  VIEWPORT_IDS,
  ANNOTATION_TOOLS,
} from './constants';
import sortImageIdsByIPP from './helpers/sortImageIdsByIPP';
import '@cornerstonejs/streaming-image-volume-loader'; // for loader to get registered

import { setCTWWWC } from './helpers/transferFunctionHelpers';

const VOLUME = 'volume';
const STACK = 'stack';

const { ViewportType } = Enums;
const { ORIENTATION } = CONSTANTS;

window.cache = cache;

let ctSceneToolGroup, stackCTViewportToolGroup;

const toolsToUse = ANNOTATION_TOOLS;
const ctLayoutTools = ['Levels'].concat(toolsToUse);
let viewportInput;
class FlipViewportExample extends Component {
  state = {
    progressText: 'fetching metadata...',
    metadataLoaded: false,
    leftClickTool: WindowLevelTool.toolName,
    layoutIndex: 0,
    destroyed: false,
    annotationsAdded: [],
    annotationsRemoved: [],
    cancelledAnnotations: null,
    annotationsModified: new Map(),
    showAnnotationEvents: false,
    deleteOnToolCancel: false,
    //
    viewportGrid: {
      numCols: 2,
      numRows: 2,
      viewports: [{}, {}, {}, {}],
    },
    ptCtLeftClickTool: 'Levels',
    viewportUIDs: ['ctAxial', 'ctSagittal', 'ctCoronal', 'ctStack'],
    selectedViewportId: 'ctAxial',
    ctWindowLevelDisplay: { ww: 0, wc: 0 },
  };

  constructor(props) {
    super(props);

    this._elementNodes = new Map();
    this._viewportGridRef = React.createRef();
    this._offScreenRef = React.createRef();

    this.ctVolumeImageIdsPromise = getImageIds('ct1', VOLUME);
    this.ctStackImageIdsPromise = getImageIds('ct1', STACK);

    const { createCameraPositionSynchronizer, createVOISynchronizer } =
      synchronizers;

    this.axialSync = createCameraPositionSynchronizer('axialSync');
    // this.sagittalSync = createCameraPositionSynchronizer('sagittalSync')
    // this.coronalSync = createCameraPositionSynchronizer('coronalSync')
    this.ctWLSync = createVOISynchronizer('ctWLSync');
    // this.ptThresholdSync = createVOISynchronizer('ptThresholdSync')

    this.viewportGridResizeObserver = new ResizeObserver((entries) => {
      // ThrottleFn? May not be needed. This is lightning fast.
      // Set in mount
      if (this.renderingEngine) {
        this.renderingEngine.resize();
        this.renderingEngine.render();
      }
    });
  }

  /**
   * LIFECYCLE
   */
  async componentDidMount() {
    await csRenderInit();
    csTools3d.init();
    ({ ctSceneToolGroup, stackCTViewportToolGroup } = initToolGroups({
      configuration: { preventHandleOutsideImage: true },
    }));

    const ctVolumeImageIds = await this.ctVolumeImageIdsPromise;
    const ctStackImageIds = await this.ctStackImageIdsPromise;

    const renderingEngine = new RenderingEngine(renderingEngineId);

    this.renderingEngine = renderingEngine;
    window.renderingEngine = renderingEngine;

    viewportInput = [
      // CT volume axial
      {
        viewportId: VIEWPORT_IDS.CT.AXIAL,
        type: ViewportType.ORTHOGRAPHIC,
        element: this._elementNodes.get(0),
        defaultOptions: {
          orientation: ORIENTATION.AXIAL,
        },
      },
      {
        viewportId: VIEWPORT_IDS.CT.SAGITTAL,
        type: ViewportType.ORTHOGRAPHIC,
        element: this._elementNodes.get(1),
        defaultOptions: {
          orientation: ORIENTATION.SAGITTAL,
        },
      },
      {
        viewportId: VIEWPORT_IDS.CT.CORONAL,
        type: ViewportType.ORTHOGRAPHIC,
        element: this._elementNodes.get(2),
        defaultOptions: {
          orientation: ORIENTATION.CORONAL,
        },
      },
      // stack CT
      {
        viewportId: VIEWPORT_IDS.STACK.CT,
        type: ViewportType.STACK,
        element: this._elementNodes.get(3),
        defaultOptions: {
          orientation: ORIENTATION.AXIAL,
        },
      },
    ];

    renderingEngine.setViewports(viewportInput);

    // volume ct
    ctSceneToolGroup.addViewport(VIEWPORT_IDS.CT.AXIAL, renderingEngineId);
    ctSceneToolGroup.addViewport(VIEWPORT_IDS.CT.SAGITTAL, renderingEngineId);
    ctSceneToolGroup.addViewport(VIEWPORT_IDS.CT.CORONAL, renderingEngineId);

    // stack ct, stack pet, and stack DX
    stackCTViewportToolGroup.addViewport(
      VIEWPORT_IDS.STACK.CT,
      renderingEngineId
    );

    addToolsToToolGroups({
      ctSceneToolGroup,
      stackCTViewportToolGroup,
    });

    this.axialSync.add({
      renderingEngineId,
      viewportId: VIEWPORT_IDS.CT.AXIAL,
    });
    this.axialSync.add({
      renderingEngineId,
      viewportId: VIEWPORT_IDS.STACK.CT,
    });

    this.ctWLSync.add({
      renderingEngineId,
      viewportId: VIEWPORT_IDS.CT.AXIAL,
    });
    this.ctWLSync.add({
      renderingEngineId,
      viewportId: VIEWPORT_IDS.CT.CORONAL,
    });
    this.ctWLSync.add({
      renderingEngineId,
      viewportId: VIEWPORT_IDS.CT.SAGITTAL,
    });
    this.ctWLSync.add({
      renderingEngineId,
      viewportId: VIEWPORT_IDS.STACK.CT,
    });

    renderingEngine.render();

    const ctStackViewport = renderingEngine.getViewport(VIEWPORT_IDS.STACK.CT);
    const ctMiddleSlice = Math.floor(ctStackImageIds.length / 2);
    await ctStackViewport.setStack(
      sortImageIdsByIPP(ctStackImageIds),
      ctMiddleSlice
    );

    ctStackViewport.setProperties({ voiRange: { lower: -160, upper: 240 } });

    // This only creates the volumes, it does not actually load all
    // of the pixel data (yet)
    const ctVolume = await volumeLoader.createAndCacheVolume(ctVolumeId, {
      imageIds: ctVolumeImageIds,
    });

    // Initialize all CT values to -1024 so we don't get a grey box?
    const { scalarData } = ctVolume;
    const ctLength = scalarData.length;

    // for (let i = 0; i < ctLength; i++) {
    //   scalarData[i] = -1024
    // }

    const onLoad = () => this.setState({ progressText: 'Loaded.' });

    ctVolume.load(onLoad);

    setVolumesForViewports(
      renderingEngine,
      [
        {
          volumeId: ctVolumeId,
          callback: setCTWWWC,
          blendMode: Enums.BlendModes.MAXIMUM_INTENSITY_BLEND,
        },
      ],
      [VIEWPORT_IDS.CT.AXIAL, VIEWPORT_IDS.CT.SAGITTAL, VIEWPORT_IDS.CT.CORONAL]
    );

    // Set initial CT levels in UI
    const { windowWidth, windowCenter } = ctVolume.metadata.voiLut[0];

    this.setState({
      metadataLoaded: true,
      ctWindowLevelDisplay: { ww: windowWidth, wc: windowCenter },
    });

    // This will initialise volumes in GPU memory
    renderingEngine.render();

    // Start listening for resize
    this.viewportGridResizeObserver.observe(this._viewportGridRef.current);
  }

  componentWillUnmount() {
    // Stop listening for resize
    if (this.viewportGridResizeObserver) {
      this.viewportGridResizeObserver.disconnect();
    }

    cache.purgeCache();
    csTools3d.destroy();

    this.renderingEngine.destroy();
  }

  showOffScreenCanvas = () => {
    // remove children
    this._offScreenRef.current.innerHTML = '';
    const uri = this.renderingEngine._debugRender();
    const image = document.createElement('img');
    image.src = uri;
    image.setAttribute('width', '100%');

    this._offScreenRef.current.appendChild(image);
  };

  hideOffScreenCanvas = () => {
    // remove children
    this._offScreenRef.current.innerHTML = '';
  };

  swapTools = (evt) => {
    const toolName = evt.target.value;

    const isAnnotationToolOn = toolName !== 'Levels' ? true : false;
    const options = {
      bindings: [{ mouseButton: csToolsEnums.MouseBindings.Primary }],
    };
    if (isAnnotationToolOn) {
      // Set tool active

      const toolsToSetPassive = toolsToUse.filter((name) => name !== toolName);

      ctSceneToolGroup.setToolActive(toolName, options);
      stackCTViewportToolGroup.setToolActive(toolName, options);

      toolsToSetPassive.forEach((toolName) => {
        ctSceneToolGroup.setToolPassive(toolName);
        stackCTViewportToolGroup.setToolPassive(toolName);
      });

      ctSceneToolGroup.setToolDisabled(WindowLevelTool.toolName);
      stackCTViewportToolGroup.setToolDisabled(WindowLevelTool.toolName);
    } else {
      // Set window level + threshold
      ctSceneToolGroup.setToolActive(WindowLevelTool.toolName, options);
      stackCTViewportToolGroup.setToolActive(WindowLevelTool.toolName, options);

      // Set all annotation tools passive
      toolsToUse.forEach((toolName) => {
        ctSceneToolGroup.setToolPassive(toolName);
        stackCTViewportToolGroup.setToolPassive(toolName);
      });
    }

    this.renderingEngine.render();
    this.setState({ ptCtLeftClickTool: toolName });
  };

  flipHorizontal = () => {
    const viewportId = this.state.selectedViewportId;
    const viewport = this.renderingEngine.getViewport(viewportId);
    const { flipHorizontal } = viewport.getProperties();
    viewport.flip({ flipHorizontal: !flipHorizontal });
  };

  flipVertical = () => {
    const viewportId = this.state.selectedViewportId;
    const viewport = this.renderingEngine.getViewport(viewportId);
    const { flipVertical } = viewport.getProperties();
    viewport.flip({ flipVertical: !flipVertical });
  };

  render() {
    return (
      <div>
        <div>
          <h1>Flip Viewport Example </h1>
          {!window.crossOriginIsolated ? (
            <h1 style={{ color: 'red' }}>
              This Demo requires SharedArrayBuffer but your browser does not
              support it
            </h1>
          ) : null}
          <p>
            This is a demo for flipping volume viewports: viewports 1,2,3 are
            volume viewports and viewport 4 (bottom right) is stack viewport
            (with only one image) of the same volume
          </p>
        </div>
        <div>
          <select
            value={this.state.ptCtLeftClickTool}
            onChange={this.swapTools}
          >
            {ctLayoutTools.map((toolName) => (
              <option key={toolName} value={toolName}>
                {toolName}
              </option>
            ))}
          </select>

          <button
            onClick={() => this.flipHorizontal()}
            className="btn btn-primary"
            style={{ margin: '2px 4px', float: 'right' }}
          >
            Flip Horizontally
          </button>
          <button
            onClick={() => this.flipVertical()}
            className="btn btn-primary"
            style={{ margin: '2px 4px', float: 'right' }}
          >
            Flip Vertically
          </button>
          <select
            style={{ margin: '2px 4px', float: 'right' }}
            value={this.state.selectedViewportId}
            onChange={(ev) =>
              this.setState({ selectedViewportId: ev.target.value })
            }
          >
            {this.state.viewportUIDs.map((viewportId) => (
              <option key={viewportId} value={viewportId}>
                {viewportId}
              </option>
            ))}
          </select>
        </div>

        <div style={{ paddingBottom: '55px' }}>
          <ViewportGrid
            numCols={this.state.viewportGrid.numCols}
            numRows={this.state.viewportGrid.numRows}
            renderingEngine={this.renderingEngine}
            style={{ minHeight: '650px', marginTop: '35px' }}
            ref={this._viewportGridRef}
          >
            {this.state.viewportGrid.viewports.map((vp, i) => (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  border: '2px solid grey',
                  background: 'black',
                  ...(vp.cellStyle || {}),
                }}
                ref={(c) => this._elementNodes.set(i, c)}
                onContextMenu={(e) => e.preventDefault()}
                key={i}
              />
            ))}
          </ViewportGrid>
        </div>
        <div>
          <h1>OffScreen Canvas Render</h1>
          <button
            onClick={this.showOffScreenCanvas}
            className="btn btn-primary"
            style={{ margin: '2px 4px' }}
          >
            Show OffScreenCanvas
          </button>
          <button
            onClick={this.hideOffScreenCanvas}
            className="btn btn-primary"
            style={{ margin: '2px 4px' }}
          >
            Hide OffScreenCanvas
          </button>
          <div ref={this._offScreenRef}></div>
        </div>
      </div>
    );
  }
}

export default FlipViewportExample;