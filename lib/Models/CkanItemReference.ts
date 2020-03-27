import i18next from "i18next";
import { runInAction, computed } from "mobx";
import { createTransformer } from "mobx-utils";
import filterOutUndefined from "../Core/filterOutUndefined";
import URI from "urijs";
import {
  isJsonObject,
  isJsonString,
  JsonArray,
  JsonObject
} from "../Core/Json";
import loadJson from "../Core/loadJson";
import Rectangle from "terriajs-cesium/Source/Core/Rectangle";
import TerriaError from "../Core/TerriaError";
import ReferenceMixin from "../ModelMixins/ReferenceMixin";
import UrlMixin from "../ModelMixins/UrlMixin";
import CkanItemReferenceTraits from "../Traits/CkanItemReferenceTraits";
import CkanResourceFormatTraits from "../Traits/CkanResourceFormatTraits";
import CatalogMemberFactory from "./CatalogMemberFactory";
import CommonStrata from "./CommonStrata";
import CreateModel from "./CreateModel";
import createStratumInstance from "./createStratumInstance";
import { BaseModel } from "./Model";
import ModelPropertiesFromTraits from "./ModelPropertiesFromTraits";
import proxyCatalogItemUrl from "./proxyCatalogItemUrl";
import StratumFromTraits from "./StratumFromTraits";
import LoadableStratum from "./LoadableStratum";
import Terria from "./Terria";
import updateModelFromJson from "./updateModelFromJson";
import ModelTraits from "../Traits/ModelTraits";
import { RectangleTraits } from "../Traits/MappableTraits";
import { InfoSectionTraits } from "../Traits/CatalogMemberTraits";
import StratumOrder from "./StratumOrder";
import GroupMixin from "../ModelMixins/GroupMixin";
import {
  CkanDataset,
  CkanOrganisation,
  CkanResource,
  CkanDatasetServerResponse,
  CkanResourceServerResponse
} from "./CkanDefinitions";
import CkanCatalogGroup from "./CkanCatalogGroup";

export class CkanDatasetStratum extends LoadableStratum(
  CkanItemReferenceTraits
) {
  static stratumName = "ckanDataset";

  constructor(
    private readonly ckanItemReference: CkanItemReference,
    private readonly ckanCatalogGroup: CkanCatalogGroup | undefined
  ) {
    super();
  }

  duplicateLoadableStratum(newModel: BaseModel): this {
    return new CkanDatasetStratum(
      this.ckanItemReference,
      this.ckanCatalogGroup
    ) as this;
  }

  static async load(
    ckanItemReference: CkanItemReference,
    ckanCatalogGroup: CkanCatalogGroup | undefined
  ) {
    if (ckanItemReference._ckanDataset === undefined) {
      // If we've got a dataset and no defined resource
      if (
        ckanItemReference.datasetId !== undefined &&
        ckanItemReference.resourceId !== undefined
      ) {
        ckanItemReference._ckanDataset = await loadCkanDataset(
          ckanItemReference
        );
        ckanItemReference._ckanResource = findResourceInDataset(
          ckanItemReference._ckanDataset,
          ckanItemReference.resourceId
        );
        ckanItemReference.setSupportedFormatFromResource(
          ckanItemReference._ckanResource
        );
      } else if (
        ckanItemReference.datasetId !== undefined &&
        ckanItemReference.resourceId === undefined
      ) {
        ckanItemReference._ckanDataset = await loadCkanDataset(
          ckanItemReference
        );
        const matched = ckanItemReference.findFirstValidResource(
          ckanItemReference._ckanDataset
        );
        if (matched === undefined) return undefined;
        ckanItemReference._ckanResource = matched.ckanResource;
        ckanItemReference._supportedFormat = matched.supportedFormat;
      } else if (
        ckanItemReference.datasetId === undefined &&
        ckanItemReference.resourceId !== undefined
      ) {
        ckanItemReference._ckanResource = await loadCkanResource(
          ckanItemReference
        );
        ckanItemReference._supportedFormat = ckanItemReference.isResourceInSupportedFormats(
          ckanItemReference._ckanResource
        );
      }
    }
    return new CkanDatasetStratum(ckanItemReference, ckanCatalogGroup);
  }

  @computed get ckanDataset(): CkanDataset | undefined {
    return this.ckanItemReference._ckanDataset;
  }

  @computed get ckanResource(): CkanResource | undefined {
    return this.ckanItemReference._ckanResource;
  }

  @computed get url() {
    if (this.ckanResource === undefined) return undefined;
    return this.ckanResource.url;
  }

  @computed get name() {
    if (this.ckanResource === undefined) return this.ckanItemReference.name;
    if (this.ckanItemReference.useResourceName) return this.ckanResource.name;
    if (this.ckanDataset) {
      if (
        this.ckanItemReference.useDatasetNameAndFormatWhereMultipleResources &&
        this.ckanDataset.resources.length > 1
      ) {
        return this.ckanDataset.title + " - " + this.ckanResource.format;
      }
      if (
        this.ckanItemReference.useCombinationNameWhereMultipleResources &&
        this.ckanDataset.resources.length > 1
      ) {
        return this.ckanDataset.title + " - " + this.ckanResource.name;
      }
      return this.ckanDataset.title;
    }
    return this.ckanResource.name;
  }

  @computed get rectangle() {
    if (this.ckanDataset === undefined) return undefined;
    if (this.ckanDataset.extras !== undefined) {
      const out: number[] = [];
      const bboxExtras = this.ckanDataset.extras.forEach(e => {
        if (e.key === "bbox-west-long") out[0] = parseFloat(e.value);
        if (e.key === "bbox-south-lat") out[1] = parseFloat(e.value);
        if (e.key === "bbox-north-lat") out[2] = parseFloat(e.value);
        if (e.key === "bbox-east-long") out[3] = parseFloat(e.value);
      });
      if (out.length === 4) {
        return createStratumInstance(RectangleTraits, {
          west: out[0],
          south: out[1],
          east: out[2],
          north: out[3]
        });
      }
    }
    if (this.ckanDataset.geo_coverage !== undefined) {
      var bboxString = this.ckanDataset.geo_coverage;
      var parts = bboxString.split(",");
      if (parts.length === 4) {
        return createStratumInstance(RectangleTraits, {
          west: parseInt(parts[0]),
          south: parseInt(parts[1]),
          east: parseInt(parts[2]),
          north: parseInt(parts[3])
        });
      }
    }
    if (this.ckanDataset.spatial !== undefined) {
      var gj = JSON.parse(this.ckanDataset.spatial);
      if (gj.type === "Polygon" && gj.coordinates[0].length === 5) {
        return createStratumInstance(RectangleTraits, {
          west: gj.coordinates[0][0][0],
          south: gj.coordinates[0][0][1],
          east: gj.coordinates[0][2][0],
          north: gj.coordinates[0][2][1]
        });
      }
    }
    return undefined;
  }

  @computed get info() {
    function newInfo(name: string, content?: string) {
      const traits = createStratumInstance(InfoSectionTraits);
      runInAction(() => {
        traits.name = name;
        traits.content = content;
      });
      return traits;
    }

    function prettifyDate(date: string) {
      if (date.match(/^\d\d\d\d-\d\d-\d\d.*/)) {
        return date.substr(0, 10);
      } else return date;
    }

    const outArray: any = [];
    if (this.ckanDataset === undefined) return outArray;
    if (this.ckanDataset.license_url !== undefined) {
      outArray.push(
        newInfo(
          i18next.t("models.ckan.licence"),
          `[${this.ckanDataset.license_title ||
            this.ckanDataset.license_url}](${this.ckanDataset.license_url})`
        )
      );
    } else if (this.ckanDataset.license_title !== undefined) {
      outArray.push({
        name: i18next.t("models.ckan.licence"),
        content: this.ckanDataset.license_title
      });
    }

    outArray.push(
      newInfo(
        i18next.t("models.ckan.contact_point"),
        this.ckanDataset.contact_point
      )
    );

    outArray.push(
      newInfo(
        i18next.t("models.ckan.datasetDescription"),
        this.ckanDataset.notes
      )
    );
    outArray.push(
      newInfo(i18next.t("models.ckan.author"), this.ckanDataset.author)
    );

    if (this.ckanDataset.organization) {
      outArray.push(
        newInfo(
          i18next.t("models.ckan.datasetCustodian"),
          this.ckanDataset.organization.description ||
            this.ckanDataset.organization.title
        )
      );
    }

    outArray.push(
      newInfo(
        i18next.t("models.ckan.metadata_created"),
        prettifyDate(this.ckanDataset.metadata_created)
      )
    );
    outArray.push(
      newInfo(
        i18next.t("models.ckan.metadata_modified"),
        prettifyDate(this.ckanDataset.metadata_modified)
      )
    );
    outArray.push(
      newInfo(
        i18next.t("models.ckan.update_freq"),
        this.ckanDataset.update_freq
      )
    );
    return outArray;
  }
}

StratumOrder.addLoadStratum(CkanDatasetStratum.stratumName);

export default class CkanItemReference extends UrlMixin(
  ReferenceMixin(CreateModel(CkanItemReferenceTraits))
) {
  static readonly defaultSupportedFormats: StratumFromTraits<
    CkanResourceFormatTraits
  >[] = [
    createStratumInstance(CkanResourceFormatTraits, {
      id: "WMS",
      formatRegex: "^wms$",
      definition: {
        type: "wms"
      }
    }),
    createStratumInstance(CkanResourceFormatTraits, {
      id: "CSV",
      formatRegex: "^csv-geo-",
      definition: {
        type: "csv"
      }
    }),
    createStratumInstance(CkanResourceFormatTraits, {
      id: "GeoJson",
      formatRegex: "^geojson$",
      definition: {
        type: "geojson"
      }
    }),
    createStratumInstance(CkanResourceFormatTraits, {
      id: "ArcGIS MapServer",
      formatRegex: "^esri rest$",
      definition: {
        type: "esri-mapServer"
      }
    }),
    createStratumInstance(CkanResourceFormatTraits, {
      id: "ArcGIS FeatureServer",
      formatRegex: "^esri rest$",
      definition: {
        type: "esri-featureServer"
      }
    }),
    createStratumInstance(CkanResourceFormatTraits, {
      id: "Kml",
      formatRegex: "^km[lz]$",
      definition: {
        type: "kml"
      }
    }),
    createStratumInstance(CkanResourceFormatTraits, {
      id: "Czml",
      formatRegex: "^czml$",
      definition: {
        type: "czml"
      }
    })
  ];

  static readonly type = "ckan-item";

  get type() {
    return CkanItemReference.type;
  }

  get typeName() {
    return i18next.t("models.ckan.name");
  }

  _ckanDataset: CkanDataset | undefined = undefined;
  _ckanResource: CkanResource | undefined = undefined;
  _ckanCatalogGroup: CkanCatalogGroup | undefined = undefined;
  _supportedFormat: PreparedSupportedFormat | undefined = undefined;

  constructor(
    id: string | undefined,
    terria: Terria,
    sourceReference?: BaseModel,
    strata?: Map<string, StratumFromTraits<ModelTraits>>
  ) {
    super(id, terria, sourceReference, strata);
    this.setTrait(
      CommonStrata.defaults,
      "supportedResourceFormats",
      CkanItemReference.defaultSupportedFormats
    );
  }

  @computed
  get preparedSupportedFormats(): PreparedSupportedFormat[] {
    return (
      this.supportedFormats && this.supportedFormats.map(prepareSupportedFormat)
    );
  }

  isResourceInSupportedFormats(
    resource: CkanResource | undefined
  ): PreparedSupportedFormat | undefined {
    if (resource === undefined) return undefined;
    for (let i = 0; i < this.preparedSupportedFormats.length; ++i) {
      const format = this.preparedSupportedFormats[i];
      if (format.formatRegex === undefined) continue;
      if (format.formatRegex.test(resource.format)) {
        return format;
      }
    }
    return undefined;
  }

  findFirstValidResource(
    dataset: CkanDataset | undefined
  ): CkanResourceWithFormat | undefined {
    if (dataset === undefined) return undefined;
    for (let i = 0; i < dataset.resources.length; ++i) {
      const r = dataset.resources[i];
      const supportedFormat = this.isResourceInSupportedFormats(r);
      if (supportedFormat !== undefined) {
        return {
          ckanResource: r,
          supportedFormat: supportedFormat
        };
      }
    }
    return undefined;
  }

  setDataset(ckanDataset: CkanDataset) {
    this._ckanDataset = ckanDataset;
  }

  setResource(ckanResource: CkanResource) {
    this._ckanResource = ckanResource;
  }

  setCkanCatalog(ckanCatalogGroup: CkanCatalogGroup) {
    this._ckanCatalogGroup = ckanCatalogGroup;
  }

  setSupportedFormatFromResource(resource: CkanResource | undefined) {
    this._supportedFormat = this.isResourceInSupportedFormats(resource);
  }

  // We will first attach this to the CkanItemReference
  // and then we'll attach it to the target model
  // I wonder if it needs to be on both?
  async setCkanStrata(model: BaseModel) {
    // not sure why this needs to be any
    const stratum = await CkanDatasetStratum.load(this, this._ckanCatalogGroup);
    if (stratum === undefined) return;
    runInAction(() => {
      model.strata.set(CkanDatasetStratum.stratumName, stratum);
    });
  }

  setItemProperties(model: BaseModel, itemProperties: any) {
    runInAction(() => {
      model.setTrait(CommonStrata.override, "itemProperties", itemProperties);
    });
  }

  async forceLoadReference(
    previousTarget: BaseModel | undefined
  ): Promise<BaseModel | undefined> {
    await this.setCkanStrata(this);

    if (this._supportedFormat === undefined) return undefined;

    const model = CatalogMemberFactory.create(
      this._supportedFormat.definition.type as string,
      this.uniqueId,
      this.terria,
      this
    );

    if (model === undefined) return;
    previousTarget = model;
    await this.setCkanStrata(model);

    const defintionStratum = this.strata.get("definition");
    if (defintionStratum) {
      model.strata.set("definition", defintionStratum);
      model.setTrait("definition", "url", undefined);
    }

    // Tried to make this sequence an updateModelFromJson but wouldn't work?
    // updateModelFromJson(model, CommonStrata.override, {itemProperties: this.itemProperties})

    // Also tried this other approach which works from the CkanCatalogGroup
    // this.setItemProperties(model, this.itemProperties)
    if (this.itemProperties !== undefined) {
      const ipKeys = Object.keys(this.itemProperties);
      ipKeys.forEach(p => {
        // @ts-ignore
        model.setTrait(CommonStrata.override, p, this.itemProperties[p]);
      });
    }

    return model;
  }
}

interface CkanResourceWithFormat {
  supportedFormat: PreparedSupportedFormat;
  ckanResource: CkanResource;
}

interface PreparedSupportedFormat {
  formatRegex: RegExp | undefined;
  definition: JsonObject;
}

async function loadCkanDataset(ckanItem: CkanItemReference) {
  var uri = new URI(ckanItem.url)
    .segment("api/3/action/package_show")
    .addQuery({ id: ckanItem.datasetId });

  const response: CkanDatasetServerResponse = await loadJson(
    proxyCatalogItemUrl(ckanItem, uri.toString(), "1d")
  );
  if (response.result) return response.result;
  return undefined;
}

async function loadCkanResource(ckanItem: CkanItemReference) {
  var uri = new URI(ckanItem.url)
    .segment("api/3/action/resource_show")
    .addQuery({ id: ckanItem.resourceId });

  const response: CkanResourceServerResponse = await loadJson(
    proxyCatalogItemUrl(ckanItem, uri.toString(), "1d")
  );
  if (response.result) return response.result;
  return undefined;
}

function findResourceInDataset(
  ckanDataset: CkanDataset | undefined,
  resourceId: string
) {
  if (ckanDataset === undefined) return undefined;
  for (let i = 0; i < ckanDataset.resources.length; ++i) {
    if (ckanDataset.resources[i].id === resourceId) {
      return ckanDataset.resources[i];
    }
  }
  return undefined;
}

const prepareSupportedFormat = createTransformer(
  (format: ModelPropertiesFromTraits<CkanResourceFormatTraits>) => {
    return {
      formatRegex: format.formatRegex
        ? new RegExp(format.formatRegex, "i")
        : undefined,
      definition: format.definition || {}
    };
  }
);