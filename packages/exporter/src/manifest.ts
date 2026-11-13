// SPDX-License-Identifier: AGPL-3.0-only
/** imsmanifest.xml for SCORM 1.2 and SCORM 2004 4th Edition. */
import type { Course } from '@clipcourse/format';
import { escapeXml } from './xml.js';

export type ScormVersion = '1.2' | '2004';

/** Turns an id into a valid xs:ID with a prefix. */
const xmlId = (prefix: string, id: string) => `${prefix}_${id.replace(/[^A-Za-z0-9_.-]/g, '_')}`;

function fileList(files: readonly string[]): string {
  return files.map((f) => `      <file href="${escapeXml(encodeUri(f))}"/>`).join('\n');
}

/** Encodes path segments for href attributes (spaces etc.), keeping slashes. */
function encodeUri(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function buildManifest(
  course: Course,
  version: ScormVersion,
  files: readonly string[],
  launch = 'index.html',
): string {
  const id = xmlId('MANIFEST', course.id);
  const org = xmlId('ORG', course.id);
  const item = xmlId('ITEM', course.id);
  const res = xmlId('RES', course.id);
  const title = escapeXml(course.title);

  if (version === '1.2') {
    return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${id}" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.imsglobal.org/xsd/imsmd_rootv1p2p1 imsmd_rootv1p2p1.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="${org}">
    <organization identifier="${org}">
      <title>${title}</title>
      <item identifier="${item}" identifierref="${res}" isvisible="true">
        <title>${title}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="${res}" type="webcontent" adlcp:scormtype="sco" href="${escapeXml(launch)}">
${fileList(files)}
    </resource>
  </resources>
</manifest>
`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${id}" version="1"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3"
  xmlns:adlnav="http://www.adlnet.org/xsd/adlnav_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imscp_v1p1 imscp_v1p1.xsd http://www.adlnet.org/xsd/adlcp_v1p3 adlcp_v1p3.xsd http://www.adlnet.org/xsd/adlseq_v1p3 adlseq_v1p3.xsd http://www.adlnet.org/xsd/adlnav_v1p3 adlnav_v1p3.xsd http://www.imsglobal.org/xsd/imsss imsss_v1p0.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 4th Edition</schemaversion>
  </metadata>
  <organizations default="${org}">
    <organization identifier="${org}">
      <title>${title}</title>
      <item identifier="${item}" identifierref="${res}">
        <title>${title}</title>
        <imsss:sequencing>
          <imsss:deliveryControls completionSetByContent="true" objectiveSetByContent="true"/>
        </imsss:sequencing>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="${res}" type="webcontent" adlcp:scormType="sco" href="${escapeXml(launch)}">
${fileList(files)}
    </resource>
  </resources>
</manifest>
`;
}
